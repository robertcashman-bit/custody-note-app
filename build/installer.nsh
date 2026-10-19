; Close ONLY the Custody Note instance running from the install directory being
; replaced/removed. Never match by image name alone (that also killed the
; Microsoft Store copy, mid-save) and never by window title (that killed any
; program whose title began "Custody Note", e.g. a Word document or browser tab).
; Graceful WM_CLOSE first, wait up to 15s, force-kill only that process as a
; last resort. $INSTDIR is passed via an environment variable so apostrophes or
; other characters in the path cannot break the PowerShell command.
; Exit codes: 0 = not running, 1 = closed gracefully, 2 = force-killed.
!macro CN_CloseOwnInstance
  System::Call 'Kernel32::SetEnvironmentVariable(t "CN_INSTDIR", t "$INSTDIR")'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d=[IO.Path]::GetFullPath($$env:CN_INSTDIR).TrimEnd('\')+'\';$$f={@(Get-Process -Name 'Custody Note' -EA 0|?{$$_.Path -and $$_.Path.StartsWith($$d,'OrdinalIgnoreCase')})};$$p=&$$f;if(!$$p.Count){exit 0};$$p|%{try{[void]$$_.CloseMainWindow()}catch{}};$$t=(Get-Date).AddSeconds(15);while((Get-Date) -lt $$t -and (&$$f).Count){Start-Sleep -m 500};$$l=&$$f;if($$l.Count){$$l|Stop-Process -Force -EA 0;Start-Sleep 2;exit 2};exit 1"`
  Pop $0
!macroend

!macro customInit
  CreateDirectory "$APPDATA\custody-note"
  FileOpen $9 "$APPDATA\custody-note\cn-nsis-install.log" a
  FileSeek $9 0 END
  FileWrite $9 "$\r$\n=== NSIS customInit START ===$\r$\n"
  FileWrite $9 "INSTDIR=$INSTDIR$\r$\n"
  FileWrite $9 "CMDLINE=$CMDLINE$\r$\n"
  FileWrite $9 "Closing Custody Note running from INSTDIR only...$\r$\n"
  !insertmacro CN_CloseOwnInstance
  FileWrite $9 "close-own-instance exit=$0 (0=none,1=graceful,2=forced)$\r$\n"
  FileWrite $9 "customInit complete$\r$\n"
  FileClose $9
!macroend

; Override the built-in un.atomicRMDir file removal. The default implementation
; tries to rename $INSTDIR atomically and ABORTs if any file handle is open
; (producing "Failed to uninstall old application files" error 2). External
; processes like IDE file watchers (Cursor) or antivirus commonly hold handles
; on app.asar. We use Delete /REBOOTOK + RMDir /r which skips locked files
; instead of aborting, then the install step overwrites with new versions.
!macro customRemoveFiles
  SetOutPath $TEMP

  ; Try to remove locked files gracefully — /REBOOTOK schedules for reboot
  ; if a handle prevents immediate deletion.
  Delete /REBOOTOK "$INSTDIR\resources\app.asar"
  Delete /REBOOTOK "$INSTDIR\resources\app.asar.bak"
  Delete /REBOOTOK "$INSTDIR\Custody Note.exe"
  Delete /REBOOTOK "$INSTDIR\Custody Note.exe.bak"

  ; Remove everything else that isn't locked.
  RMDir /r "$INSTDIR"
!macroend

!macro customUnInit
  !insertmacro CN_CloseOwnInstance
!macroend
