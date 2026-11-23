#!/usr/bin/env python3
"""Build offline Windows x64 desktop launchers and a per-user installer.

Requires Python 3, GCC x86-64 with -mabi=ms, GNU binutils with i386pep support.
No Windows SDK, downloaded binary, network service, CRT, or elevation needed.
The generated import libraries are metadata only; dummy DLLs never ship.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import zlib
from elf_to_coff import convert

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / 'build'
DIST = ROOT / 'dist'
IMPORTS = {
    'KERNEL32': ['CloseHandle', 'CopyFileW', 'CreateDirectoryW', 'CreateFileW', 'DeleteFileW', 'ExitProcess', 'ExpandEnvironmentStringsW', 'FlushFileBuffers', 'GetCommandLineW', 'GetCurrentProcessId', 'GetFileAttributesW', 'GetLastError', 'GetModuleFileNameW', 'GetTempPathW', 'LocalFree', 'MoveFileExW', 'RemoveDirectoryW', 'Sleep', 'WriteFile'],
    'USER32': ['MessageBoxW'],
    'SHELL32': ['CommandLineToArgvW', 'SHGetFolderPathW', 'ShellExecuteW'],
    'SHLWAPI': ['UrlCreateFromPathW'],
    'ADVAPI32': ['RegCloseKey', 'RegCreateKeyExW', 'RegDeleteTreeW', 'RegOpenKeyExW', 'RegQueryValueExW', 'RegSetValueExW'],
    'OLE32': ['CoCreateInstance', 'CoInitialize', 'CoUninitialize'],
}
FLAGS = ['-c', '-std=c11', '-Os', '-fshort-wchar', '-mabi=ms', '-maccumulate-outgoing-args', '-mno-red-zone', '-fpie', '-fno-asynchronous-unwind-tables', '-fno-unwind-tables', '-fno-stack-protector', '-ffreestanding', '-fno-builtin', '-fno-ident', '-Wall', '-Wextra', '-Wno-unused-function']


def run(*args):
    result = subprocess.run([str(a) for a in args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(str(a) for a in args) + '\n' + result.stdout + result.stderr)
    if result.stderr:
        print(result.stderr.strip(), file=sys.stderr)
    return result.stdout


def compile_c(source, name):
    elf = BUILD / (name + '.elf.o')
    coff = BUILD / (name + '.obj')
    run('gcc', *FLAGS, '-I', ROOT, '-I', BUILD, source, '-o', elf)
    convert(elf, coff)
    return coff


def import_libraries():
    libraries = []
    for dll, symbols in IMPORTS.items():
        c = BUILD / (dll + '-import-stubs.c')
        c.write_text('\n'.join('void ' + symbol + '(void) {}' for symbol in symbols) + '\n')
        obj = compile_c(c, dll + '-import-stubs')
        definition = BUILD / (dll + '.def')
        definition.write_text('LIBRARY ' + dll + '.dll\nEXPORTS\n' + '\n'.join(symbols) + '\n')
        library = BUILD / (dll + '.a')
        run('ld', '-m', 'i386pep', '--dll', '--entry', '0', '--no-insert-timestamp', '--out-implib', library, '-o', BUILD / (dll + '-metadata-only.dll'), obj, definition)
        libraries.append(library)
    return libraries


def icon_png(size=64):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            fx, fy = (x+.5)*64/size, (y+.5)*64/size
            cx, cy = min(max(fx,12),52), min(max(fy,12),52)
            visible = (fx-cx)**2+(fy-cy)**2 <= 144
            glyph = (19 <= fx < 25 and 15 <= fy < 49) or (22 <= fx < 38 and (15 <= fy < 21 or 30 <= fy < 36)) or (36 <= fx < 43 and 20 <= fy < 31)
            rgba = (255,255,255,255) if glyph else (40,91,70,255 if visible else 0)
            rows.extend(rgba)
    def chunk(kind, data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(rows),9))+chunk(b'IEND',b'')


def resource_data(name):
    manifest = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">'
        '<assemblyIdentity version="0.1.0.0" processorArchitecture="amd64" name="PromptDraft.'+name+'" type="win32"/>'
        '<description>Prompt Draft offline document editor</description>'
        '<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>'
        '<requestedExecutionLevel level="asInvoker" uiAccess="false"/>'
        '</requestedPrivileges></security></trustInfo>'
        '<compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>'
        '<supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>'
        '</application></compatibility></assembly>').encode()
    icon = icon_png()
    group = struct.pack('<HHHBBBBHHIH',0,1,1,64,64,0,0,1,32,len(icon),1)
    tree = {3:{1:{1033:icon}},14:{1:{1033:group}},24:{1:{1033:manifest}}}
    directories = []
    leaves = []
    offset = 0
    def allocate(node):
        nonlocal offset
        here=offset;offset+=16+8*len(node)
        record={'offset':here,'children':[]};directories.append(record)
        for key,value in sorted(node.items()):
            if isinstance(value,dict):
                target=allocate(value)
                record['children'].append((key,0x80000000|target))
            else:
                leaf={'data':value,'entry':None,'payload':None}
                leaves.append(leaf);record['children'].append((key,leaf))
        return here
    allocate(tree)
    for leaf in leaves:
        leaf['entry']=offset;offset+=16
    offset=(offset+3)&~3
    for leaf in leaves:
        leaf['payload']=offset;offset=(offset+len(leaf['data'])+3)&~3
    output=bytearray(offset)
    for directory in directories:
        at=directory['offset']
        struct.pack_into('<IIHHHH',output,at,0,0,0,0,0,len(directory['children']))
        for i,(key,target) in enumerate(directory['children']):
            if isinstance(target,dict):target=target['entry']
            struct.pack_into('<II',output,at+16+8*i,key,target)
    patches=[]
    for leaf in leaves:
        struct.pack_into('<IIII',output,leaf['entry'],leaf['payload'],len(leaf['data']),65001,0)
        output[leaf['payload']:leaf['payload']+len(leaf['data'])]=leaf['data']
        patches.append((leaf['entry'],leaf['payload']))
    return bytes(output),patches


def pe_sections(data):
    pe=struct.unpack_from('<I',data,0x3c)[0]
    if data[pe:pe+4]!=b'PE\0\0':raise ValueError('Missing PE signature')
    machine,count,_,_,_,optional,_=struct.unpack_from('<HHIIIHH',data,pe+4)
    sections=[]
    for i in range(count):
        at=pe+24+optional+i*40
        name=bytes(data[at:at+8]).rstrip(b'\0').decode()
        vsize,rva,size,raw=struct.unpack_from('<IIII',data,at+8)
        flags=struct.unpack_from('<I',data,at+36)[0]
        sections.append({'name':name,'rva':rva,'vsize':vsize,'size':size,'raw':raw,'flags':flags})
    return pe,machine,sections


def checksum(data, offset):
    struct.pack_into('<I',data,offset,0)
    total=0
    for i in range(0,len(data),2):
        word=data[i]+((data[i+1] if i+1<len(data) else 0)<<8)
        total+=word;total=(total&0xffff)+(total>>16)
    total=(total&0xffff)+(total>>16)
    return total+len(data)


def build_executable(source,name,libraries):
    obj=compile_c(ROOT/source,name)
    resources,patches=resource_data(name)
    binary=BUILD/(name+'-resources.bin');binary.write_bytes(resources)
    resource_obj=BUILD/(name+'-resources.obj')
    run('objcopy','-I','binary','-O','pe-x86-64','-B','i386:x86-64','--rename-section','.data=.rsrc,alloc,load,readonly,data,contents',binary,resource_obj)
    output=DIST/(name+'.exe')
    run('ld','-m','i386pep','--subsystem','windows','--major-subsystem-version','6','--minor-subsystem-version','0','--major-os-version','6','--minor-os-version','0','--entry','entry','--image-base','0x140000000','--dynamicbase','--nxcompat','--high-entropy-va','--no-insert-timestamp','-Map',BUILD/(name+'.map'),'-s','-o',output,obj,resource_obj,*libraries)
    data=bytearray(output.read_bytes());pe,machine,sections=pe_sections(data)
    resource=next(s for s in sections if s['name']=='.rsrc')
    for entry,payload in patches:
        struct.pack_into('<I',data,resource['raw']+entry,resource['rva']+payload)
    struct.pack_into('<I',data,pe+24+64,checksum(data,pe+24+64))
    output.write_bytes(data)
    return output


def payload_header(launcher,uninstaller,app_dir):
    payloads={
        'launcher':launcher.read_bytes(),
        'uninstaller':uninstaller.read_bytes(),
        'html':(app_dir/'index.html').read_bytes(),
        'readme':(app_dir/'README.txt').read_bytes(),
    }
    parts=['/* Generated embedding of the exact application release files. */']
    for name,data in payloads.items():
        parts.append('static const unsigned char '+name+'_payload[] = {')
        parts.extend(','.join(str(v) for v in data[start:start+32])+',' for start in range(0,len(data),32))
        parts.append('};\nstatic const DWORD '+name+'_payload_size = '+str(len(data))+';')
    (BUILD/'payload.h').write_text('\n'.join(parts)+'\n')
    return payloads


def validate(path):
    data=path.read_bytes();pe,machine,sections=pe_sections(data)
    optional=pe+24
    if machine!=0x8664 or struct.unpack_from('<H',data,optional)[0]!=0x20b:raise ValueError('Not a Windows x64 PE32+ executable')
    if struct.unpack_from('<H',data,optional+68)[0]!=2:raise ValueError('Not a GUI executable')
    if b'requestedExecutionLevel level="asInvoker"' not in data:raise ValueError('Missing asInvoker manifest')
    if any((s['flags']&0x20000000) and (s['flags']&0x80000000) for s in sections):raise ValueError('Writable executable section')
    if struct.unpack_from('<I',data,optional+64)[0]!=checksum(bytearray(data),optional+64):raise ValueError('PE checksum mismatch')
    dump=run('objdump','-p',path)
    dlls=re.findall(r'DLL Name:\s+(\S+)',dump)
    allowed={name+'.DLL' for name in IMPORTS}
    if not dlls or any(name.upper() not in allowed for name in dlls):raise ValueError('Unexpected DLL dependency')
    # Every resource data descriptor must point into .rsrc, not a section-relative value.
    resource=next(s for s in sections if s['name']=='.rsrc')
    def walk(offset):
        start=resource['raw']+offset
        named,ids=struct.unpack_from('<HH',data,start+12)
        for i in range(named+ids):
            _,target=struct.unpack_from('<II',data,start+16+i*8)
            if target&0x80000000:walk(target&0x7fffffff)
            else:
                rva,size=struct.unpack_from('<II',data,resource['raw']+target)
                if not resource['rva']<=rva<resource['rva']+resource['vsize']:raise ValueError('Invalid resource RVA')
                if rva+size>resource['rva']+resource['vsize']:raise ValueError('Resource extends outside section')
    walk(0)
    return {'file':path.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'machine':'AMD64','subsystem':'Windows GUI','manifest':'asInvoker','imports':dlls,'windows_runtime_tested':False,'sections':sections}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--app-dir',type=Path,default=ROOT.parent/'prompt-draft-app')
    args=parser.parse_args();app_dir=args.app_dir.resolve()
    for name in ['index.html','README.txt']:
        if not (app_dir/name).is_file():raise SystemExit('Missing release input: '+str(app_dir/name))
    BUILD.mkdir(exist_ok=True);DIST.mkdir(exist_ok=True)
    libraries=import_libraries()
    launcher=build_executable('launcher.c','PromptDraft',libraries)
    uninstaller=build_executable('uninstaller.c','Uninstall',libraries)
    payloads=payload_header(launcher,uninstaller,app_dir)
    installer=build_executable('installer.c','PromptDraft-Setup-0.1.0-x64',libraries)
    installer_data=installer.read_bytes()
    for name,data in payloads.items():
        if data not in installer_data:raise ValueError('Installer missing exact payload: '+name)
    report={'version':'0.1.0','files':[validate(p) for p in [launcher,uninstaller,installer]],'payloads':{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in payloads.items()},'validation':'Static PE/ABI/import/manifest/resource/payload checks only. A Windows end-to-end install/uninstall test has not been performed.'}
    (DIST/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'installer':str(installer),'bytes':installer.stat().st_size,'sha256':hashlib.sha256(installer_data).hexdigest()},indent=2))


if __name__=='__main__':
    main()
