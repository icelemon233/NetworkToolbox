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
