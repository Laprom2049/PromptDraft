#ifndef PROMPT_DRAFT_WINLITE_H
#define PROMPT_DRAFT_WINLITE_H

/* Minimal, explicitly sized Win32 declarations. GCC is compiled with the
 * Microsoft x64 ABI and 16-bit wchar_t; no CRT or third-party DLL is used. */
typedef unsigned short WCHAR;
typedef unsigned int DWORD;
typedef unsigned int UINT;
typedef int LONG;
typedef int BOOL;
typedef int HRESULT;
typedef unsigned long long ULONG_PTR;
typedef void *HANDLE;
typedef void *HWND;
typedef void *HKEY;
typedef void *HINSTANCE;
typedef struct { DWORD a; unsigned short b,c; unsigned char d[8]; } GUID;

#define CAP 4096
#define URLCAP 16384
#define NULL ((void *)0)
#define INVALID_HANDLE ((HANDLE)(long long)-1)
#define HKCU ((HKEY)(long long)(int)0x80000001U)
#define HKLM ((HKEY)(long long)(int)0x80000002U)
#define REG_SZ 1
#define REG_DWORD 4
#define MB_OK 0
#define MB_OKCANCEL 1
#define MB_YESNO 4
#define MB_ICONERROR 0x10
#define MB_ICONQUESTION 0x20
#define MB_ICONINFORMATION 0x40
#define IDOK 1
#define IDYES 6
#define CSIDL_DESKTOPDIRECTORY 0x10
#define CSIDL_PROGRAMS 0x02
#define CSIDL_LOCAL_APPDATA 0x1c
#define CSIDL_PROGRAM_FILES 0x26
#define CSIDL_PROGRAM_FILESX86 0x2a
#define CSIDL_FLAG_CREATE 0x8000
#define UNINSTALL_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PromptDraft"

extern int MessageBoxW(HWND,const WCHAR*,const WCHAR*,UINT);
extern void ExitProcess(UINT) __attribute__((noreturn));
extern DWORD GetModuleFileNameW(HANDLE,WCHAR*,DWORD);
extern DWORD GetFileAttributesW(const WCHAR*);
extern DWORD GetLastError(void);
extern BOOL CreateDirectoryW(const WCHAR*,void*);
extern HANDLE CreateFileW(const WCHAR*,DWORD,DWORD,void*,DWORD,DWORD,HANDLE);
extern BOOL WriteFile(HANDLE,const void*,DWORD,DWORD*,void*);
extern BOOL FlushFileBuffers(HANDLE);
extern BOOL CloseHandle(HANDLE);
extern BOOL DeleteFileW(const WCHAR*);
extern BOOL RemoveDirectoryW(const WCHAR*);
extern BOOL MoveFileExW(const WCHAR*,const WCHAR*,DWORD);
extern BOOL CopyFileW(const WCHAR*,const WCHAR*,BOOL);
extern DWORD GetTempPathW(DWORD,WCHAR*);
extern DWORD GetCurrentProcessId(void);
extern void Sleep(DWORD);
extern WCHAR *GetCommandLineW(void);
extern DWORD ExpandEnvironmentStringsW(const WCHAR*,WCHAR*,DWORD);
extern void *LocalFree(void*);
extern HRESULT SHGetFolderPathW(HWND,int,HANDLE,DWORD,WCHAR*);
extern HINSTANCE ShellExecuteW(HWND,const WCHAR*,const WCHAR*,const WCHAR*,const WCHAR*,int);
extern WCHAR **CommandLineToArgvW(const WCHAR*,int*);
extern HRESULT UrlCreateFromPathW(const WCHAR*,WCHAR*,DWORD*,DWORD);
extern LONG RegOpenKeyExW(HKEY,const WCHAR*,DWORD,DWORD,HKEY*);
extern LONG RegQueryValueExW(HKEY,const WCHAR*,DWORD*,DWORD*,unsigned char*,DWORD*);
extern LONG RegCreateKeyExW(HKEY,const WCHAR*,DWORD,WCHAR*,DWORD,DWORD,void*,HKEY*,DWORD*);
extern LONG RegSetValueExW(HKEY,const WCHAR*,DWORD,DWORD,const unsigned char*,DWORD);
extern LONG RegDeleteTreeW(HKEY,const WCHAR*);
extern LONG RegCloseKey(HKEY);
extern HRESULT CoInitialize(void*);
extern void CoUninitialize(void);
extern HRESULT CoCreateInstance(const GUID*,void*,DWORD,const GUID*,void**);

static unsigned wlen(const WCHAR *s) { unsigned n=0; while(s[n])++n; return n; }
static BOOL wcopy(WCHAR *to,unsigned cap,const WCHAR *from) {
    unsigned i=0; if(!cap)return 0;
    while(from[i]) { if(i+1>=cap){to[0]=0;return 0;}to[i]=from[i];++i; }
    to[i]=0;return 1;
}
static BOOL wappend(WCHAR *to,unsigned cap,const WCHAR *from) {
    unsigned n=wlen(to);if(n>=cap)return 0;return wcopy(to+n,cap-n,from);
}
static BOOL wequal(const WCHAR*a,const WCHAR*b) {
    unsigned i=0;while(a[i]&&b[i]&&a[i]==b[i])++i;return a[i]==b[i];
}
static BOOL path_join(WCHAR*out,unsigned cap,const WCHAR*dir,const WCHAR*name) {
    return wcopy(out,cap,dir)&&wappend(out,cap,L"\\")&&wappend(out,cap,name);
}
static void decimal(DWORD value,WCHAR*out) {
    WCHAR t[12];unsigned n=0,i=0;
    do{t[n++]=(WCHAR)(L'0'+value%10);value/=10;}while(value);
    while(n)out[i++]=t[--n];
    out[i]=0;
}
static int message(const WCHAR *text,UINT flags) {
    return MessageBoxW(NULL,text,L"Prompt 文稿",flags);
}
static void error(const WCHAR *text) { message(text,MB_OK|MB_ICONERROR); }
static BOOL file_exists(const WCHAR*p) {
    DWORD a=GetFileAttributesW(p);return a!=0xffffffffU&&!(a&0x10);
}
static BOOL ensure_dir(const WCHAR*p) {
    if(CreateDirectoryW(p,NULL))return 1;
    DWORD a=GetFileAttributesW(p);return a!=0xffffffffU&&(a&0x10);
}
static BOOL local_root(WCHAR*out) {
    WCHAR p[260];
    if(SHGetFolderPathW(NULL,CSIDL_LOCAL_APPDATA|CSIDL_FLAG_CREATE,NULL,0,p)<0)return 0;
    return path_join(out,CAP,p,L"PromptDraft");
}
static BOOL module_directory(WCHAR*out) {
    DWORD n=GetModuleFileNameW(NULL,out,CAP);
    if(!n||n>=CAP)return 0;
    while(n&&out[n]!=L'\\'&&out[n]!=L'/')--n;
    if(!n)return 0;
    out[n]=0;return 1;
}
static BOOL registry_edge(HKEY root,WCHAR*out) {
    HKEY k;DWORD type=0,size=CAP*sizeof(WCHAR);LONG r;
    if(RegOpenKeyExW(root,L"Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",0,0x101,&k))return 0;
    r=RegQueryValueExW(k,NULL,NULL,&type,(unsigned char*)out,&size);RegCloseKey(k);
    if(r||!size||size>CAP*sizeof(WCHAR))return 0;
    out[CAP-1]=0;
    if(type==2){static WCHAR expanded[CAP];DWORD n=ExpandEnvironmentStringsW(out,expanded,CAP);if(!n||n>=CAP)return 0;wcopy(out,CAP,expanded);}
    else if(type!=REG_SZ)return 0;
    unsigned n=wlen(out);
    if(n>1&&out[0]==L'"'&&out[n-1]==L'"') { unsigned i=0;while(i+2<n){out[i]=out[i+1];++i;}out[i]=0; }
    return file_exists(out);
}
static BOOL find_edge(WCHAR*out) {
    if(registry_edge(HKCU,out)||registry_edge(HKLM,out))return 1;
    WCHAR folder[260];
    int ids[3]={CSIDL_PROGRAM_FILESX86,CSIDL_PROGRAM_FILES,CSIDL_LOCAL_APPDATA};
    for(unsigned i=0;i<3;i++) {
        if(SHGetFolderPathW(NULL,ids[i],NULL,0,folder)>=0&&path_join(out,CAP,folder,L"Microsoft\\Edge\\Application\\msedge.exe")&&file_exists(out))return 1;
    }
    return 0;
}

static BOOL write_atomic(const WCHAR*path,const unsigned char*data,DWORD length) {
    static WCHAR temporary[CAP];
    if(!wcopy(temporary,CAP,path)||!wappend(temporary,CAP,L".new"))return 0;
    HANDLE f=CreateFileW(temporary,0x40000000,0,NULL,2,0x80,NULL);
    if(f==INVALID_HANDLE)return 0;
    DWORD written=0;
    BOOL ok=WriteFile(f,data,length,&written,NULL)&&written==length;
    if(ok)ok=FlushFileBuffers(f);
    CloseHandle(f);
    if(ok)ok=MoveFileExW(temporary,path,0x9);
    if(!ok)DeleteFileW(temporary);
    return ok;
}

/* IUnknown indices 0..2; IShellLinkW::SetPath=20,
 * SetDescription=7, SetWorkingDirectory=9, SetIconLocation=17.
 * IPersistFile::Save=6. */
static BOOL create_shortcut(const WCHAR*target,const WCHAR*workdir,const WCHAR*linkpath,const WCHAR*description) {
    static const GUID clsid={0x00021401,0,0,{0xc0,0,0,0,0,0,0,0x46}};
    static const GUID shell_iid={0x000214f9,0,0,{0xc0,0,0,0,0,0,0,0x46}};
    static const GUID persist_iid={0x0000010b,0,0,{0xc0,0,0,0,0,0,0,0x46}};
    void *shell=NULL,*persist=NULL;BOOL ok=0;
    if(CoCreateInstance(&clsid,NULL,1,&shell_iid,&shell)<0)return 0;
    void **v=*(void***)shell;
    typedef HRESULT(*SetText)(void*,const WCHAR*);
    typedef HRESULT(*SetIcon)(void*,const WCHAR*,int);
    typedef HRESULT(*Query)(void*,const GUID*,void**);
    typedef DWORD(*Release)(void*);
    if(((SetText)v[20])(shell,target)>=0&&((SetText)v[9])(shell,workdir)>=0) {
        ((SetText)v[7])(shell,description);
        ((SetIcon)v[17])(shell,target,0);
        if(((Query)v[0])(shell,&persist_iid,&persist)>=0) {
            void **p=*(void***)persist;
            typedef HRESULT(*Save)(void*,const WCHAR*,BOOL);
            ok=((Save)p[6])(persist,linkpath,1)>=0;
            ((Release)p[2])(persist);
        }
    }
    ((Release)v[2])(shell);return ok;
}
#endif
