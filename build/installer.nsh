!macro customInit
  ; Kill any running instances of Custody Note before installing/updating
  ; This prevents "Failed to uninstall old application files" errors
  nsExec::ExecToLog 'taskkill /F /IM "Custody Note.exe" /T'
  nsExec::ExecToLog 'taskkill /F /FI "WINDOWTITLE eq Custody Note*"'
  ; Brief pause to allow OS to release file handles
  Sleep 2000
!macroend

!macro customUnInit
  ; Also kill before uninstall
  nsExec::ExecToLog 'taskkill /F /IM "Custody Note.exe" /T'
  Sleep 1000
!macroend
