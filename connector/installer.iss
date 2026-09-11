#define MyAppName "Fluid Connector"
#define MyAppVersion "0.1.0"
#define MyAppExeName "FluidConnector.exe"

[Setup]
AppId={{B3221D4B-8335-45C8-B94B-54190B20A998}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\Fluid Connector
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=FluidConnectorSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "dist\FluidConnector.exe"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FluidConnector"; ValueData: """{app}\{#MyAppExeName}"" --installed"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\fluid"; ValueType: string; ValueData: "URL:Fluid Connector"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\fluid"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\fluid\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" --installed ""%1"""

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--installed --first-run"; Description: "Connect this computer to Fluid"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/IM FluidConnector.exe /F"; Flags: runhidden; RunOnceId: "StopFluidConnector"
