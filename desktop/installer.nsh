!define ToolboxLifecycle "${__FILEDIR__}\..\native\publish\NetworkToolbox.Native.exe"
!include "${__FILEDIR__}\installer-files.nsh"

; Set these before MUI creates either install or uninstall pages.
!define MUI_HEADERIMAGE_UNBITMAP "${PROJECT_DIR}\assets\installer-header.bmp"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装 ${PRODUCT_NAME} ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "查看无线信道、诊断连接并管理本机网络配置。$\r$\n$\r$\n支持 Windows 11 x64，已包含 Electron 和 .NET 运行库，无需另装 Node.js 或 .NET。$\r$\n$\r$\n升级和卸载会保留本地检测记录与设置。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载 ${PRODUCT_NAME} ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "将移除 ${PRODUCT_NAME} 的程序文件，本地检测记录与设置会保留。$\r$\n$\r$\n如果应用正在运行，向导会请求正常退出；未能完成退出时将停止卸载。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customHeader
  Caption "${PRODUCT_NAME} ${VERSION} 安装"
  UninstallCaption "${PRODUCT_NAME} ${VERSION} 卸载"
  BrandingText "${PRODUCT_NAME}"
!macroend

!macro customCheckAppRunning
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=NetworkToolbox-Lifecycle.exe "${ToolboxLifecycle}"
  nsExec::ExecToStack /TIMEOUT=25000 '"$PLUGINSDIR\NetworkToolbox-Lifecycle.exe" --ensure-exit --install-dir "$INSTDIR"'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$R1"
    ${EndIf}
    SetErrorLevel 20
    Quit
  ${EndIf}
  SetOutPath "$INSTDIR"
!macroend

; Give each release its own shell icon path so an old EXE cache cannot mask new artwork.
; Only refresh shortcuts which already exist after electron-builder's preference handling.
!macro customInstall
  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\app-icon-${VERSION}.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newDesktopLink", p 0)'
  ${endif}
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\app-icon-${VERSION}.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$newStartMenuLink", p 0)'
  ${endif}
!macroend
