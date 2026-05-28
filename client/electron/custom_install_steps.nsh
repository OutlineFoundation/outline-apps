; Copyright 2018 The Outline Authors
;
; Licensed under the Apache License, Version 2.0 (the "License");
; you may not use this file except in compliance with the License.
; You may obtain a copy of the License at
;
;      http://www.apache.org/licenses/LICENSE-2.0
;
; Unless required by applicable law or agreed to in writing, software
; distributed under the License is distributed on an "AS IS" BASIS,
; WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
; See the License for the specific language governing permissions and
; limitations under the License.

!include StrFunc.nsh
!include WinVer.nsh
!include x64.nsh

!include env.nsh

; StrFunc weirdness; this fix suggested here:
; https://github.com/electron-userland/electron-builder/issues/888
!ifndef BUILD_UNINSTALLER
${StrLoc}
${StrNSISToIO}
${StrRep}
!endif

!macro customInstall
  ; Normally, because we mark the installer binary as requiring administrator permissions, the
  ; installer will be running with administrator permissions at this point. The exception is when
  ; the system is running with the *lowest* (least safe) UAC setting in which case the installer
  ; can progress to this point without administrator permissions.
  ;
  ; If that's the case, exit now so we don't waste time to trying to install the TAP device, etc.
  ; Additionally, the client can detect their absence and prompt the user to reinstall.
  ;
  ; The returned value does *not* seem to be based on the user's current diaplay language.
  UserInfo::GetAccountType
  Pop $0
  StrCmp $0 "Admin" isadmin
  MessageBox MB_OK "Sorry, Outline requires administrator permissions."
  Quit

  isadmin:

  ; TAP device files. Pick the arch-specific driver bundle.
  ; ${RunningX64} is true on both x64 and arm64 Windows, so check arm64 first.
  SetOutPath "$INSTDIR\tap-windows6"
  ${If} ${IsNativeARM64}
    File /r "${PROJECT_DIR}\third_party\tap-windows6\bin\arm64\*"
  ${ElseIf} ${RunningX64}
    File /r "${PROJECT_DIR}\third_party\tap-windows6\bin\amd64\*"
  ${Else}
    File /r "${PROJECT_DIR}\third_party\tap-windows6\bin\i386\*"
  ${EndIf}
  SetOutPath -
  File "${PROJECT_DIR}\client\electron\add_tap_device.bat"
  File "${PROJECT_DIR}\client\electron\find_tap_device_name.bat"

  ; OutlineService files, stopping the service first in case it's still running.
  nsExec::Exec "$SYSDIR\net stop OutlineService"
  File "${PROJECT_DIR}\client\electron\windows\OutlineService\OutlineService\bin\OutlineService.exe"
  File "${PROJECT_DIR}\client\electron\windows\smartdnsblock\bin\smartdnsblock.exe"
  File "${PROJECT_DIR}\third_party\newtonsoft\Newtonsoft.Json.dll"
  File "${PROJECT_DIR}\client\electron\install_windows_service.bat"

  ; ExecToStack captures both stdout and stderr from the script, in the order output.
  ; Set a (long) timeout in case the device never becomes visible to netsh.
  ReadEnvStr $0 COMSPEC
  nsExec::ExecToStack /timeout=180000 '$0 /c add_tap_device.bat'

  Pop $0
  Pop $1
  StrCmp $0 0 installservice

  ; The TAP device may have failed to install because the user did not want to
  ; install the device driver. If so:
  ;  - tell the user that they need to install the driver
  ;  - skip the Sentry report
  ;  - quit
  ;
  ; When this happens, tapinstall.exe prints an error message like this:
  ; UpdateDriverForPlugAndPlayDevices failed, GetLastError=-536870333
  ;
  ; We can use the presence of that magic number to detect this case.
  Var /GLOBAL DRIVER_FAILURE_MAGIC_NUMBER_INDEX
  ${StrLoc} $DRIVER_FAILURE_MAGIC_NUMBER_INDEX $1 "536870333" ">"

  StrCmp $DRIVER_FAILURE_MAGIC_NUMBER_INDEX "" submitsentryreport
  ; The term "device software" is the same as that used by the prompt, at least on Windows 7.
  MessageBox MB_OK "Sorry, you must install the device software in order to use Outline. Please try \
    running the installer again."
  Quit

  submitsentryreport:
  MessageBox MB_OK "Sorry, we could not configure your system to connect to Outline. Please try \
    running the installer again. If you still cannot install Outline, please get in \
    touch with us and let us know that the TAP device failed to install with error code $0."

  ; Submit a Sentry error event.
  ;
  ; This will get bundled into an issue named "could not install TAP device" with the following
  ; attributes:
  ;  - a single breadcrumb containing the output of add_tap_device.bat
  ;  - Windows version, as a tag named "os" with a value identical in most cases to what the
  ;    JavaScript Sentry client produces, e.g. "Windows 10.0.17134"
  ;  - client version
  ;
  ; Note:
  ;  - Sentry won't accept a breadcrumbs without a timestamp; fortunately, it accepts obviously
  ;    bogus values so we don't have to fetch the real time.
  ;  - Because nsExec::ExecToStack yields "NSIS strings" strings suitable for inclusion in, for
  ;    example, a MessageBox, e.g. "device not found$\ncommand failed", we must convert it to a
  ;    string that Sentry will like *and* can fit on one line, e.g.
  ;    "device not found\ncommand failed"; fortunately, StrFunc.nsh's StrNSISToIO does precisely
  ;    this.
  ;  - RELEASE and SENTRY_URL are defined in env.nsh which is generated at build time by
  ;    {package,release}_action.sh.

  ; TODO: Remove this once we figure out why/if breadcrumbs are being truncated.
  Var /GLOBAL FAILURE_MESSAGE_LENGTH
  StrLen $FAILURE_MESSAGE_LENGTH $1

  ; http://nsis.sourceforge.net/Docs/StrFunc/StrFunc.txt
  Var /GLOBAL FAILURE_MESSAGE
  ${StrNSISToIO} $FAILURE_MESSAGE $1
  ${StrRep} $FAILURE_MESSAGE $FAILURE_MESSAGE '"' '\"'

  ${WinVerGetMajor} $R0
  ${WinVerGetMinor} $R1
  ${WinVerGetBuild} $R2

  ; http://nsis.sourceforge.net/Inetc_plug-in#post
  inetc::post '{\
    "message":"could not install TAP device ($0)",\
    "release":"${RELEASE}",\
    "tags":[\
      ["os", "Windows $R0.$R1.$R2"],\
      ["error_message_length", "$FAILURE_MESSAGE_LENGTH"]\
    ],\
    "breadcrumbs":[\
      {"timestamp":1, "message":"$FAILURE_MESSAGE"}\
    ]\
  }' /TOSTACK ${SENTRY_URL} /END

  Quit

  installservice:

  nsExec::Exec install_windows_service.bat

  nsExec::Exec "$SYSDIR\sc query OutlineService"
  Pop $0
  StrCmp $0 0 success
  ; TODO: Trigger a Sentry report for service installation failure, too, and revisit
  ;       the restart stuff in the TypeScript code.
  MessageBox MB_OK "Sorry, we could not configure your system to connect to Outline. Please try \
    running the installer again. If you still cannot install Outline, please get in touch with us \
    and let us know that OutlineService failed to install."
  Quit

  success:

!macroend

; TODO: Remove the TAP device on uninstall. This is impossible to implement safely
;       with the bundled tapinstall.exe because it can only remove *all* devices
;       having hwid tap0901 and these may include non-Outline devices.
!macro customUnInstall
  nsExec::Exec "$SYSDIR\net stop OutlineService"
  nsExec::Exec "$SYSDIR\sc delete OutlineService"
!macroend
