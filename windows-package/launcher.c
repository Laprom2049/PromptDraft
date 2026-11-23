#include "winlite.h"
static WCHAR appdir[CAP],html[CAP],edge[CAP],root[CAP],profile[CAP];
static WCHAR url[URLCAP],arguments[URLCAP+CAP+200];

void entry(void) {
    if(!module_directory(appdir)||!path_join(html,CAP,appdir,L"index.html")||!file_exists(html)) {
        error(L"找不到编辑器文件 index.html。请重新安装 Prompt 文稿。");ExitProcess(1);
    }
    if(!find_edge(edge)) {
        error(L"未找到 Microsoft Edge。\n\nPrompt 文稿使用 Edge 显示本地编辑器。请先安装或修复 Microsoft Edge，然后重新打开应用。\n\n程序不会自动下载任何内容。");ExitProcess(2);
    }
    if(!local_root(root)||!ensure_dir(root)||!path_join(profile,CAP,root,L"BrowserData")||!ensure_dir(profile)) {
        error(L"无法创建本地文稿数据目录。请检查当前用户的文件夹权限。");ExitProcess(3);
    }
    DWORD capacity=URLCAP;
    if(UrlCreateFromPathW(html,url,&capacity,0)<0) {
        error(L"无法转换编辑器文件路径。请重新安装到当前用户的默认目录。");ExitProcess(4);
    }
    if(!wcopy(arguments,URLCAP+CAP+200,L"--app=\"")||!wappend(arguments,URLCAP+CAP+200,url)||
       !wappend(arguments,URLCAP+CAP+200,L"\" --user-data-dir=\"")||!wappend(arguments,URLCAP+CAP+200,profile)||
       !wappend(arguments,URLCAP+CAP+200,L"\" --no-first-run --no-default-browser-check")) {
        error(L"应用路径过长，无法启动。");ExitProcess(5);
    }
    HINSTANCE result=ShellExecuteW(NULL,L"open",edge,arguments,appdir,1);
    if((ULONG_PTR)result<=32) {error(L"无法启动 Microsoft Edge。请确认 Edge 可以正常打开，再重新启动 Prompt 文稿。");ExitProcess(6);}
    ExitProcess(0);
}
