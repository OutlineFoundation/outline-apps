; Copyright 2024 The Outline Authors
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

!include LogicLib.nsh
!include x64.nsh

; Defensive migration cleanup for electron-builder#8672.
;
; The Manager historically shipped only a 32-bit (ia32) Windows build. On an
; ARM64 Windows machine a user may have that ia32 build installed via x86
; emulation. When they move to the new combined installer, the native arm64
; slice runs in the 64-bit registry view and cannot see the ia32 install's
; uninstall entry, which lives in the 32-bit (WOW6432Node) view. electron-builder's
; built-in "uninstall previous version" step only checks the installer's own
; view, so the stale 32-bit copy would be left behind alongside the new one.
;
; To avoid that, when the running installer is 64-bit (arm64/x64) we explicitly
; look in the 32-bit view for a prior per-user install and, if one exists, run
; its uninstaller silently before continuing. The common cases are unaffected:
;  - 32-bit (ia32) installs share the 32-bit view, so ${RunningX64} gates this
;    off and electron-builder's native same-view uninstall handles them.
;  - Fresh arm64 installs find no stale entry and this is a no-op.
;
; NOTE: The Manager installer is per-user (perMachine=false, oneClick), so the
; legacy entry lives under HKCU. This mitigation is best-effort and still needs
; to be validated on an ARM64 Windows VM (ia32 -> combined upgrade path).
!macro customInit
  ${If} ${RunningX64}
    SetRegView 32
    ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "QuietUninstallString"
    SetRegView lastused
    ${If} $R1 != ""
      DetailPrint "Removing previous 32-bit Outline Manager installation (electron-builder#8672)..."
      ; QuietUninstallString already includes the silent (/S) flag.
      ExecWait '$R1'
    ${EndIf}
  ${EndIf}
!macroend
