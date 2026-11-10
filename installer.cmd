@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  == Device Frame Preview : installation dans VS Code ==
echo.
call npx --yes @vscode/vsce package -o ayzann-device-frame-preview.vsix
if errorlevel 1 goto erreur
call code --install-extension ayzann-device-frame-preview.vsix --force
if errorlevel 1 goto erreur
echo.
echo  OK ! Recharge VS Code (Ctrl+Shift+P puis "Recharger la fenetre").
echo  Ensuite : bouton "Preview" en bas a droite, ou Ctrl+Alt+P.
echo.
pause
exit /b 0
:erreur
echo.
echo  L installation a echoue, voir le message ci-dessus.
pause
exit /b 1
