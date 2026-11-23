"""Checked GCC ELF64-to-COFF bridge for freestanding Windows x64 C.

objcopy supplies section layout/flags only. We rebuild the symbol/string table
from ELF and rewrite every relocation target/addend. Unsupported features fail.
"""
from pathlib import Path
import struct
import subprocess


def convert(source, destination):
    source, destination = Path(source), Path(destination)
    elf = source.read_bytes()
    if elf[:6] != b'\x7fELF\x02\x01':
        raise ValueError('Expected little-endian ELF64 object')
    shoff = struct.unpack_from('<Q', elf, 40)[0]
    shsize, shnum, shstrndx = struct.unpack_from('<HHH', elf, 58)
    sections = [struct.unpack_from('<IIQQQQIIQQ', elf, shoff + i * shsize) for i in range(shnum)]
    strings = sections[shstrndx]
    names = elf[strings[4]:strings[4]+strings[5]]
    def cstring(data, offset):
        return data[offset:data.index(0,offset)].decode()
    def section_name(section):
        return cstring(names,section[0])
    relocations = {}
    for section in sections:
        if section[1] != 4:
            continue
        target = section_name(sections[section[7]])
        for offset in range(section[4],section[4]+section[5],section[9]):
            address,info,addend = struct.unpack_from('<QQq',elf,offset)
            relocations[(target,address)] = (info & 0xffffffff,addend,section[6],info >> 32)
    subprocess.run(['objcopy','--remove-section=.comment','--remove-section=.note.GNU-stack','-O','pe-x86-64',str(source),str(destination)],check=True)
    coff = bytearray(destination.read_bytes())
    _,count,_,symbol_pointer,symbol_count,opt_size,_ = struct.unpack_from('<HHIIIHH',coff,0)
    old_string_base = symbol_pointer+symbol_count*18
    coff_sections = []
    string_table = bytearray(b'\0\0\0\0')
    string_offsets = {}
    def add_string(text):
        if text not in string_offsets:
            string_offsets[text] = len(string_table)
            string_table.extend(text.encode()+b'\0')
        return string_offsets[text]
    for index in range(count):
        at=20+opt_size+index*40
        raw_name=bytes(coff[at:at+8]).split(b'\0',1)[0]
        if raw_name.startswith(b'/'):
            start=old_string_base+int(raw_name[1:])
            name=bytes(coff[start:coff.index(0,start)]).decode()
            new_name=('/'+str(add_string(name))).encode()
            if len(new_name)>8:
                raise ValueError('COFF section string offset too large')
            coff[at:at+8]=new_name.ljust(8,b'\0')
        else:
            name=raw_name.decode()
        raw_size,raw_pointer,relocation_pointer=struct.unpack_from('<III',coff,at+16)
        relocation_count=struct.unpack_from('<H',coff,at+32)[0]
        coff_sections.append({'name':name,'index':index+1,'raw_size':raw_size,'raw':raw_pointer,'relocations':relocation_pointer,'count':relocation_count})
    by_name={s['name']:s for s in coff_sections}
    symbols=bytearray()
    symbol_map={}
    for table_index,table in enumerate(sections):
        if table[1]!=2:
            continue
        string_section=sections[table[6]]
        symbol_names=elf[string_section[4]:string_section[4]+string_section[5]]
        for index,at in enumerate(range(table[4],table[4]+table[5],table[9])):
            name_offset,info,visibility,section_index,value,size=struct.unpack_from('<IBBHQQ',elf,at)
            kind,binding=info & 15,info >> 4
            if index==0 or kind==4:
                continue
            name=cstring(symbol_names,name_offset)
            if section_index==0:
                number=0
                if not name:
                    raise ValueError('Unnamed undefined ELF symbol')
            elif section_index==0xfff1:
                number=-1
            elif section_index>=len(sections):
                raise ValueError('Unsupported special ELF section index')
            else:
                original_section=section_name(sections[section_index])
                if original_section not in by_name:
                    if any(item[2:]==(table_index,index) for item in relocations.values()):
                        raise ValueError('Relocation references removed section '+original_section)
                    continue
                number=by_name[original_section]['index']
                if kind==3:
                    name=original_section
            if not name or not 0<=value<=0xffffffff:
                raise ValueError('Unrepresentable COFF symbol')
            if binding not in (0,1):
                raise ValueError('Unsupported ELF weak/unique symbol')
            name_bytes=name.encode()
            packed_name=name_bytes.ljust(8,b'\0') if len(name_bytes)<=8 else struct.pack('<II',0,add_string(name))
            symbol_map[(table_index,index)]=len(symbols)//18
            symbols.extend(struct.pack('<8sIhHBB',packed_name,value,number,0x20 if kind==2 else 0,3 if binding==0 else 2,0))
    seen=set()
    for section in coff_sections:
        for index in range(section['count']):
            at=section['relocations']+index*10
            address=struct.unpack_from('<I',coff,at)[0]
            key=(section['name'],address)
            if key not in relocations:
                raise ValueError('COFF relocation has no ELF source')
            kind,addend,table,original_symbol=relocations[key]
            if (table,original_symbol) not in symbol_map:
                raise ValueError('ELF relocation target was not preserved')
            if kind in (2,4):
                windows_kind,fmt,value=4,'<i',addend+4
            elif kind==1:
                windows_kind,fmt,value=1,'<q',addend
            elif kind in (10,11):
                windows_kind,fmt,value=2,'<i',addend
            else:
                raise ValueError(f'Unsupported ELF relocation {kind}')
            width=struct.calcsize(fmt)
            if not section['raw'] or address+width>section['raw_size']:
                raise ValueError('Relocation outside initialized data')
            struct.pack_into('<IIH',coff,at,address,symbol_map[(table,original_symbol)],windows_kind)
            struct.pack_into(fmt,coff,section['raw']+address,value)
            seen.add(key)
    expected={key for key in relocations if key[0] in by_name}
    if seen!=expected:
        raise ValueError('Not all ELF relocations converted')
    struct.pack_into('<I',string_table,0,len(string_table))
    struct.pack_into('<I',coff,12,len(symbols)//18)
    destination.write_bytes(coff[:symbol_pointer]+symbols+string_table)


if __name__=='__main__':
    import sys
    convert(sys.argv[1],sys.argv[2])
