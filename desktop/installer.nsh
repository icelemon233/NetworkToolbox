!define ToolboxLifecycle "${__FILEDIR__}\..\native\publish\NetworkToolbox.Native.exe"
!include "${__FILEDIR__}\installer-files.nsh"

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
