#!/usr/bin/env python3
"""Independently verify ELF RELA -> COFF -> linked PE relocation expressions.

This is release-review code, not part of the application or build converter.
It reads the original ELF symbol's section/value/addend and verifies that the
converted COFF expression denotes the same address.  With a GNU ld map, it
also verifies every resulting relocated field in the final executable.

Run from any directory:
  python review/verify_relocations.py --coff-only
  python review/verify_relocations.py --output review/relocation-report.json

The second form requires build/<name>.map for each linked executable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys


NAMES = ("PromptDraft", "Uninstall", "PromptDraft-Setup-0.1.0-x64")


def cstring(data: bytes, offset: int) -> str:
    return data[offset:data.index(0, offset)].decode("utf-8", "replace")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_elf(data: bytes):
    if data[:6] != b"\x7fELF\x02\x01":
        raise ValueError("expected little-endian ELF64")
    shoff = struct.unpack_from("<Q", data, 40)[0]
    shsize, shnum, shstrndx = struct.unpack_from("<HHH", data, 58)
    raw = [struct.unpack_from("<IIQQQQIIQQ", data, shoff + i * shsize)
           for i in range(shnum)]
    strings = raw[shstrndx]
    section_strings = data[strings[4]:strings[4] + strings[5]]
    sections = []
    for item in raw:
        sections.append({"name": cstring(section_strings, item[0]),
                         "type": item[1], "offset": item[4], "size": item[5],
                         "link": item[6], "info": item[7], "entsize": item[9]})
    symbol_tables = {}
    for index, section in enumerate(sections):
        if section["type"] != 2:
            continue
        strings = sections[section["link"]]
        names = data[strings["offset"]:strings["offset"] + strings["size"]]
        symbols = []
        for pos in range(section["offset"], section["offset"] + section["size"],
                         section["entsize"]):
            name, info, other, shndx, value, size = struct.unpack_from("<IBBHQQ", data, pos)
            symbols.append({"name": cstring(names, name), "section_index": shndx,
                            "type": info & 15, "value": value})
        symbol_tables[index] = symbols
    relocations = {}
    for section in sections:
        if section["type"] != 4:
            continue
        target = sections[section["info"]]["name"]
        symbols = symbol_tables[section["link"]]
        for pos in range(section["offset"], section["offset"] + section["size"],
                         section["entsize"]):
            offset, info, addend = struct.unpack_from("<QQq", data, pos)
            symbol = symbols[info >> 32]
            shndx = symbol["section_index"]
            if shndx == 0:
                base = ("undefined", symbol["name"])
            elif shndx == 0xfff1 and symbol["type"] != 4:
                base = ("absolute", "")
            elif 0 < shndx < len(sections):
                base = ("section", sections[shndx]["name"])
            else:
                raise ValueError("ELF relocation references unsupported special symbol: " + repr(symbol))
            relocations[(target, offset)] = {"kind": info & 0xffffffff,
                                             "addend": addend, "symbol": symbol,
                                             "base": base, "value": symbol["value"]}
    return sections, relocations


def read_coff(data: bytes):
    machine, count, stamp, symptr, symcount, optsize, flags = struct.unpack_from("<HHIIIHH", data)
    if machine != 0x8664 or optsize:
        raise ValueError("expected AMD64 COFF object")
    string_base = symptr + symcount * 18

    def symbol_name(raw):
        if raw[:4] == b"\0" * 4:
            return cstring(data, string_base + struct.unpack_from("<I", raw, 4)[0])
        return raw.split(b"\0", 1)[0].decode("utf-8", "replace")

    sections = []
    for index in range(count):
        pos = 20 + index * 40
        raw_name, vsize, va, size, rawptr, relptr, lineptr, nrel, nline, flags = struct.unpack_from("<8sIIIIIIHHI", data, pos)
        if raw_name.startswith(b"/"):
            name = cstring(data, string_base + int(raw_name[1:].split(b"\0", 1)[0]))
        else:
            name = raw_name.split(b"\0", 1)[0].decode("utf-8", "replace")
        sections.append({"name": name, "rawptr": rawptr, "size": size,
                         "relptr": relptr, "nrel": nrel})
    symbols = {}
    index = 0
    while index < symcount:
        raw_name, value, section, stype, storage, naux = struct.unpack_from("<8sIhHBB", data, symptr + index * 18)
        symbols[index] = {"name": symbol_name(raw_name), "value": value,
                          "section_index": section, "storage": storage}
        index += 1 + naux
    relocations = {}
    for section in sections:
        for index in range(section["nrel"]):
            offset, symindex, kind = struct.unpack_from("<IIH", data, section["relptr"] + index * 10)
            if symindex not in symbols:
                raise ValueError("COFF relocation references auxiliary or nonexistent symbol")
            symbol = symbols[symindex]
            shndx = symbol["section_index"]
            if shndx == 0:
                base = ("undefined", symbol["name"])
            elif shndx == -1:
                base = ("absolute", "")
            elif 0 < shndx <= len(sections):
                base = ("section", sections[shndx - 1]["name"])
            else:
                base = ("invalid-special", symbol["name"])
            widths = {1: 8, 2: 4, 4: 4}
            if kind not in widths:
                raise ValueError(f"unexpected COFF relocation kind {kind}")
            width = widths[kind]
            if not section["rawptr"] or offset + width > section["size"]:
                raise ValueError("COFF relocation extends outside initialized section")
            fmt = "<q" if width == 8 else "<i"
            value = struct.unpack_from(fmt, data, section["rawptr"] + offset)[0]
            relocations[(section["name"], offset)] = {"kind": kind, "addend": value,
                                                       "symbol": symbol, "base": base,
                                                       "value": symbol["value"]}
    return sections, relocations


def read_map(text: str, object_name: str):
    """Get input-section contribution bases and resolved public symbol VAs."""
    sections = {}
    symbols = {}
    pending = None
    contribution = re.compile(r"^\s*(\.[^\s]+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(.+?)\s*$")
    continuation = re.compile(r"^\s*(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)\s+(.+?)\s*$")
    bare_section = re.compile(r"^\s+(\.[^\s]+)\s*$")
    address_symbol = re.compile(r"^\s*(0x[0-9a-fA-F]+)\s+([A-Za-z_.$?@][^\s]*)\s*$")
    for line in text.splitlines():
        match = contribution.match(line)
        section = None
        if match:
            section, address, size, filename = match.groups()
        elif pending:
            match = continuation.match(line)
            if match:
                address, size, filename = match.groups()
                section = pending
        if section is not None and Path(filename).name == object_name:
            if section in sections and sections[section] != int(address, 16):
                raise ValueError("ambiguous input-section map contribution: " + section)
            sections[section] = int(address, 16)
        bare = bare_section.match(line)
        pending = bare.group(1) if bare else None
        match = address_symbol.match(line)
        if match:
            address, symbol = match.groups()
            symbols.setdefault(symbol, set()).add(int(address, 16))
    return sections, symbols


def read_pe(data: bytes):
    pe = struct.unpack_from("<I", data, 0x3c)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("not a PE image")
    machine, count, stamp, symptr, symcount, optsize, flags = struct.unpack_from("<HHIIIHH", data, pe + 4)
    optional = pe + 24
    if machine != 0x8664 or struct.unpack_from("<H", data, optional)[0] != 0x20b:
        raise ValueError("not an AMD64 PE32+ image")
    imagebase = struct.unpack_from("<Q", data, optional + 24)[0]
    sections = []
    for index in range(count):
        pos = optional + optsize + index * 40
        name, vsize, rva, size, rawptr = struct.unpack_from("<8sIIII", data, pos)
        sections.append({"name": name.split(b"\0", 1)[0].decode(), "vsize": vsize,
                         "va": imagebase + rva, "rawptr": rawptr, "size": size})

    def field(va, width):
        for section in sections:
            offset = va - section["va"]
            if 0 <= offset and offset + width <= section["size"] and section["rawptr"]:
                return int.from_bytes(data[section["rawptr"] + offset:section["rawptr"] + offset + width], "little")
        raise ValueError(f"linked relocation place 0x{va:x} is outside file-backed PE data")
    return field


def review(root: Path, name: str, coff_only: bool):
    elf_path = root / "build" / (name + ".elf.o")
    coff_path = root / "build" / (name + ".obj")
    elf_data = elf_path.read_bytes()
    coff_data = coff_path.read_bytes()
    _, elf = read_elf(elf_data)
    _, coff = read_coff(coff_data)
    report = {"name": name, "original_relocations": len(elf),
              "coff_relocations": len(coff), "linked_fields_checked": 0,
              "sha256": {"elf": digest(elf_data), "coff": digest(coff_data)}, "errors": []}
    errors = report["errors"]
    if set(elf) != set(coff):
        errors.append("relocation locations differ: ELF-only=" + repr(sorted(set(elf) - set(coff))) + "; COFF-only=" + repr(sorted(set(coff) - set(elf))))
    for location in sorted(set(elf) & set(coff)):
        a, b = elf[location], coff[location]
        kinds = {1: 1, 2: 4, 4: 4, 10: 2, 11: 2}
        if a["kind"] not in kinds:
            errors.append(f"{location}: unsupported ELF relocation kind {a['kind']}")
            continue
        adjustment = 4 if a["kind"] in (2, 4) else 0
        expected = (a["base"], a["value"] + a["addend"] + adjustment)
        actual = (b["base"], b["value"] + b["addend"])
        if kinds[a["kind"]] != b["kind"] or expected != actual:
            errors.append(f"{location}: original expression {expected!r} != COFF {actual!r}; COFF symbol={b['symbol']!r}")
    if coff_only:
        report["linked_validation"] = "not requested"
        return report
    map_path = root / "build" / (name + ".map")
    pe_path = root / "dist" / (name + ".exe")
    if not map_path.exists():
        errors.append("required linker map missing: " + str(map_path))
        return report
    map_data = map_path.read_bytes()
    pe_data = pe_path.read_bytes()
    report["sha256"].update({"map": digest(map_data), "exe": digest(pe_data)})
    section_bases, symbols = read_map(map_data.decode("utf-8", "replace"), coff_path.name)
    field = read_pe(pe_data)
    for location, relocation in sorted(elf.items()):
        source_section, offset = location
        kind = relocation["kind"]
        try:
            place = section_bases[source_section] + offset
            domain, target = relocation["base"]
            if domain == "section":
                symbol_address = section_bases[target] + relocation["value"]
            elif domain == "undefined":
                candidates = symbols[target]
                if len(candidates) != 1:
                    raise ValueError("ambiguous symbol addresses: " + target)
                symbol_address = next(iter(candidates)) + relocation["value"]
            else:
                symbol_address = relocation["value"]
            if kind in (2, 4):
                expected = symbol_address + relocation["addend"] - place
                width = 4
                if not -(1 << 31) <= expected < (1 << 31):
                    raise ValueError("PC-relative result exceeds signed 32-bit range")
            elif kind == 1:
                expected = symbol_address + relocation["addend"]
                width = 8
            elif kind in (10, 11):
                expected = symbol_address + relocation["addend"]
                width = 4
                if not -(1 << 31) <= expected < (1 << 32):
                    raise ValueError("absolute result exceeds representable 32-bit range")
            else:
                raise ValueError("unsupported linked relocation kind")
            actual = field(place, width)
            expected &= (1 << (width * 8)) - 1
            if actual != expected:
                errors.append(f"{location}: PE field at VA 0x{place:x} has 0x{actual:x}, expected 0x{expected:x} from original ELF symbol VA 0x{symbol_address:x}")
            report["linked_fields_checked"] += 1
        except (KeyError, ValueError) as exception:
            errors.append(f"{location}: linked verification unavailable: {exception}")
    report["linked_validation"] = "all original relocation fields evaluated"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--coff-only", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--names", nargs="+", default=list(NAMES))
    args = parser.parse_args()
    reports = []
    for name in args.names:
        try:
            result = review(args.root, name, args.coff_only)
        except Exception as exception:
            result = {"name": name, "errors": [f"review could not complete: {type(exception).__name__}: {exception}"]}
        reports.append(result)
        print(f"{name}: {len(result['errors'])} errors; ELF relocations={result.get('original_relocations', '?')}; linked fields={result.get('linked_fields_checked', 0)}")
        for error in result["errors"][:6]:
            print("  " + error)
    output = {"method": "Independent original ELF symbol section/value/addend equality, plus linker-map-based PE field verification", "pass": all(not item["errors"] for item in reports), "artifacts": reports}
    if args.output:
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if output["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
