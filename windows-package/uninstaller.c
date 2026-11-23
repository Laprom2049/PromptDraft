#include "winlite.h"
static WCHAR root[CAP],path[CAP],programs[CAP],temporary[CAP],self[CAP];
static WCHAR notice[CAP+900];
static BOOL remove_file(const WCHAR*name) {
    if(!path_join(path,CAP,root,name))return 0;
    for(unsigned i=0;i<10;i++) {
        if(DeleteFileW(path))return 1;
        DWORD e=GetLastError();if(e==2||e==3)return 1;
        Sleep(100);
    }
    return 0;
}
static BOOL cleanup_requested(void) {
    int count=0;WCHAR **args=CommandLineToArgvW(GetCommandLineW(),&count);
    if(!args)return 0;
    BOOL result=count==2&&wequal(args[1],L"--cleanup");LocalFree(args);return result;
}
static BOOL remove_shortcut(const WCHAR*folder,const WCHAR*name) {
    if(!path_join(path,CAP,folder,name))return 0;
    if(DeleteFileW(path))return 1;
    DWORD e=GetLastError();return e==2||e==3;
}
static void cleanup_failed(void) {
    wcopy(notice,CAP+900,L"卸载未完整完成。部分应用文件或快捷方式无法删除。请关闭相关窗口后重试。\n\n卸载程序会尽量保留可重试的入口。安装目录：\n");
    wappend(notice,CAP+900,root);wappend(notice,CAP+900,L"\n\nBrowserData 中的文稿数据保持不变。");error(notice);ExitProcess(1);
}
static void cleanup(void) {
    Sleep(400);
    BOOL ok=1;
    if(!remove_file(L"PromptDraft.exe"))ok=0;
    if(!remove_file(L"index.html"))ok=0;
    if(!remove_file(L"README.txt"))ok=0;
    if(!remove_file(L"PromptDraft.exe.new"))ok=0;
    if(!remove_file(L"index.html.new"))ok=0;
    if(!remove_file(L"README.txt.new"))ok=0;
    if(!remove_file(L"Uninstall.exe.new"))ok=0;
    /* Leave Uninstall.exe, its registration and every shortcut available if
       ordinary application file removal failed. */
    if(!ok)cleanup_failed();
    WCHAR special[260];
    if(SHGetFolderPathW(NULL,CSIDL_DESKTOPDIRECTORY,NULL,0,special)<0||!remove_shortcut(special,L"Prompt 文稿.lnk"))ok=0;
    if(SHGetFolderPathW(NULL,CSIDL_PROGRAMS,NULL,0,special)>=0&&path_join(programs,CAP,special,L"Prompt 文稿")) {
        if(!remove_shortcut(programs,L"Prompt 文稿.lnk"))ok=0;
        if(!remove_shortcut(programs,L"卸载 Prompt 文稿.lnk"))ok=0;
    } else ok=0;
    if(!ok)cleanup_failed();
    if(!remove_file(L"Uninstall.exe"))cleanup_failed();
    LONG registry=RegDeleteTreeW(HKCU,UNINSTALL_KEY);
    if(registry&&registry!=2) {
        /* Restore the per-user uninstall executable if registration could not
           be removed, so Windows Settings retains a usable retry target. */
        if(path_join(path,CAP,root,L"Uninstall.exe"))CopyFileW(self,path,0);
        cleanup_failed();
    }
    RemoveDirectoryW(programs);
    /* Only an empty application directory may be removed. Never walk or delete
       BrowserData, unknown files, or any directory recursively. */
    RemoveDirectoryW(root);
    wcopy(notice,CAP+900,L"Prompt 文稿已卸载。\n\nBrowserData 中的本地草稿和偏好设置已保留：\n");
    wappend(notice,CAP+900,root);wappend(notice,CAP+900,L"\\BrowserData\n\n再次安装到同一位置后，可以继续使用保留的数据。\n\n临时卸载文件由系统临时文件清理机制处理。");
    message(notice,MB_OK|MB_ICONINFORMATION);
    ExitProcess(0);
}
void entry(void) {
    if(!local_root(root)){error(L"无法确定当前用户的安装目录，未执行卸载。");ExitProcess(1);}
    DWORD n=GetModuleFileNameW(NULL,self,CAP);if(!n||n>=CAP){error(L"无法确定卸载程序位置，未执行卸载。");ExitProcess(2);}
    if(cleanup_requested())cleanup();
    if(message(L"要卸载 Prompt 文稿吗？\n\n请先关闭编辑器窗口。\n应用文件、桌面和开始菜单快捷方式将被移除。\nBrowserData 中的本地草稿和偏好设置将保留。",MB_OKCANCEL|MB_ICONQUESTION)!=IDOK)ExitProcess(0);
    n=GetTempPathW(CAP,temporary);if(!n||n>=CAP){error(L"无法访问临时目录，未执行卸载。");ExitProcess(3);}
    WCHAR pid[12];decimal(GetCurrentProcessId(),pid);
    if(!wappend(temporary,CAP,L"PromptDraft-Uninstall-")||!wappend(temporary,CAP,pid)||!wappend(temporary,CAP,L".exe")||!CopyFileW(self,temporary,0)) {
        error(L"无法准备临时卸载程序，未执行卸载。请检查临时目录权限。");ExitProcess(4);
    }
    HINSTANCE launched=ShellExecuteW(NULL,L"open",temporary,L"--cleanup",root,1);
    if((ULONG_PTR)launched<=32){DeleteFileW(temporary);error(L"无法启动临时卸载程序，未执行卸载。");ExitProcess(5);}
    ExitProcess(0);
}
