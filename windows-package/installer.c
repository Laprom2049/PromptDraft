#include "winlite.h"
#include "payload.h"
static WCHAR root[CAP],path[CAP],target[CAP],uninstall[CAP],edge[CAP];
static WCHAR notice[CAP+1200],programs[CAP],link[CAP],command[CAP+20];

static void failed(const WCHAR*reason) {
    wcopy(notice,CAP+1200,L"安装未完整完成。\n\n");wappend(notice,CAP+1200,reason);
    wappend(notice,CAP+1200,L"\n\n请关闭 Prompt 文稿后重新运行安装程序。已写入的应用文件可能保留在：\n");
    wappend(notice,CAP+1200,root);
    wappend(notice,CAP+1200,L"\n\nBrowserData 中的文稿数据不会被安装程序删除。");
    error(notice);ExitProcess(1);
}
static BOOL install_file(const WCHAR*name,const unsigned char*bytes,DWORD size) {
    return path_join(path,CAP,root,name)&&write_atomic(path,bytes,size);
}
static BOOL reg_string(HKEY key,const WCHAR*name,const WCHAR*value) {
    return RegSetValueExW(key,name,0,REG_SZ,(const unsigned char*)value,(wlen(value)+1)*2)==0;
}
static BOOL uninstall_registration(void) {
    HKEY key;DWORD disposition,one=1;BOOL ok;
    if(RegCreateKeyExW(HKCU,UNINSTALL_KEY,0,NULL,0,0x20106,NULL,&key,&disposition))return 0;
    if(!wcopy(command,CAP+20,L"\"")||!wappend(command,CAP+20,uninstall)||!wappend(command,CAP+20,L"\"")){RegCloseKey(key);return 0;}
    ok=reg_string(key,L"DisplayName",L"Prompt 文稿")&&
       reg_string(key,L"DisplayVersion",L"0.1.0")&&
       reg_string(key,L"Publisher",L"Prompt Draft")&&
       reg_string(key,L"InstallLocation",root)&&
       reg_string(key,L"DisplayIcon",target)&&
       reg_string(key,L"UninstallString",command)&&
       RegSetValueExW(key,L"NoModify",0,REG_DWORD,(const unsigned char*)&one,4)==0&&
       RegSetValueExW(key,L"NoRepair",0,REG_DWORD,(const unsigned char*)&one,4)==0;
    RegCloseKey(key);return ok;
}
void entry(void) {
    if(!local_root(root)){error(L"无法找到当前用户的本地应用数据目录，安装未开始。");ExitProcess(1);}
    if(!find_edge(edge)){error(L"未找到 Microsoft Edge，安装未开始。\n\nPrompt 文稿需要 Windows 10/11 x64 和 Microsoft Edge。请先安装或修复 Edge，然后重新运行本安装包。\n\n本安装程序不会联网下载依赖。");ExitProcess(2);}
    if(!wcopy(notice,CAP+1200,L"即将安装 Prompt 文稿 0.1.0。\n\n安装位置：\n")||!wappend(notice,CAP+1200,root)||
       !wappend(notice,CAP+1200,L"\n\n仅为当前用户安装，无需管理员权限。\n将添加桌面和开始菜单快捷方式。\n\n请先关闭正在运行的 Prompt 文稿。\n安装和更新会保留 BrowserData 中的草稿。\n\n继续安装？")) {error(L"安装路径过长。");ExitProcess(3);}
    if(message(notice,MB_OKCANCEL|MB_ICONINFORMATION)!=IDOK)ExitProcess(0);
    if(!ensure_dir(root))failed(L"无法创建安装目录，请检查文件夹权限和磁盘空间。");
    if(!install_file(L"PromptDraft.exe",launcher_payload,launcher_payload_size))failed(L"无法写入桌面启动程序 PromptDraft.exe。");
    if(!install_file(L"index.html",html_payload,html_payload_size))failed(L"无法写入编辑器页面 index.html。");
    if(!install_file(L"README.txt",readme_payload,readme_payload_size))failed(L"无法写入使用说明 README.txt。");
    if(!install_file(L"Uninstall.exe",uninstaller_payload,uninstaller_payload_size))failed(L"无法写入卸载程序 Uninstall.exe。");
    if(!path_join(target,CAP,root,L"PromptDraft.exe")||!path_join(uninstall,CAP,root,L"Uninstall.exe"))failed(L"安装路径过长。");
    if(!uninstall_registration())failed(L"应用文件已写入，但无法在当前用户注册表中创建卸载入口。");
    if(CoInitialize(NULL)<0)failed(L"应用文件已写入，但无法初始化 Windows 快捷方式组件。");
    WCHAR special[260];BOOL shortcuts=1;
    if(SHGetFolderPathW(NULL,CSIDL_DESKTOPDIRECTORY|CSIDL_FLAG_CREATE,NULL,0,special)<0||
       !path_join(link,CAP,special,L"Prompt 文稿.lnk")||!create_shortcut(target,root,link,L"编辑、复用与检查提示词文稿"))shortcuts=0;
    if(SHGetFolderPathW(NULL,CSIDL_PROGRAMS|CSIDL_FLAG_CREATE,NULL,0,special)<0||
       !path_join(programs,CAP,special,L"Prompt 文稿")||!ensure_dir(programs))shortcuts=0;
    else {
        if(!path_join(link,CAP,programs,L"Prompt 文稿.lnk")||!create_shortcut(target,root,link,L"编辑、复用与检查提示词文稿"))shortcuts=0;
        if(!path_join(link,CAP,programs,L"卸载 Prompt 文稿.lnk")||!create_shortcut(uninstall,root,link,L"卸载应用并保留本地文稿数据"))shortcuts=0;
    }
    CoUninitialize();
    if(!shortcuts)failed(L"应用文件和卸载入口已建立，但无法创建全部快捷方式。可检查桌面和开始菜单的写入权限后重试。");
    if(message(L"Prompt 文稿已安装完成。\n\n编辑器会尝试更新本机自动恢复副本；请定期保存项目文件。\n\n现在打开编辑器？",MB_YESNO|MB_ICONINFORMATION)==IDYES) {
        HINSTANCE launched=ShellExecuteW(NULL,L"open",target,NULL,root,1);
        if((ULONG_PTR)launched<=32)error(L"安装已完成，但未能自动启动。请使用桌面上的“Prompt 文稿”快捷方式打开。");
    }
    ExitProcess(0);
}
