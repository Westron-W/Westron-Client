!ifndef BUILD_UNINSTALLER
!define MUI_TEXTCOLOR "F2ECFF"
!define MUI_BGCOLOR "241A3A"
LangString WESTRON_WELCOME_TITLE 1055 "Hoş Geldiniz!"
LangString WESTRON_WELCOME_TEXT 1055 "Bu yükleyici Westron Launcher'ı bilgisayarınıza kuracaktır.$\r$\n$\r$\nKuruluma devam etmek için Devam'a tıklayın."
LangString WESTRON_WELCOME_TITLE 1033 "Welcome!"
LangString WESTRON_WELCOME_TEXT 1033 "This installer will set up Westron Launcher on your computer.$\r$\n$\r$\nClick Next to continue."
LangString WESTRON_WELCOME_TITLE 1031 "Willkommen!"
LangString WESTRON_WELCOME_TEXT 1031 "Dieser Installer richtet Westron Launcher auf Ihrem Computer ein.$\r$\n$\r$\nKlicken Sie auf Weiter."
LangString WESTRON_WELCOME_TITLE 1036 "Bienvenue!"
LangString WESTRON_WELCOME_TEXT 1036 "Ce programme installera Westron Launcher sur votre ordinateur.$\r$\n$\r$\nCliquez sur Suivant."
LangString WESTRON_WELCOME_TITLE 3082 "¡Bienvenido!"
LangString WESTRON_WELCOME_TEXT 3082 "Este asistente instalará Westron Launcher en tu ordenador.$\r$\n$\r$\nHaz clic en Siguiente."
LangString WESTRON_WELCOME_TITLE 1049 "Добро пожаловать!"
LangString WESTRON_WELCOME_TEXT 1049 "Этот мастер установит Westron Launcher на ваш компьютер.$\r$\n$\r$\nНажмите Далее."
LangString WESTRON_WELCOME_TITLE 1040 "Benvenuto!"
LangString WESTRON_WELCOME_TEXT 1040 "Questa procedura installerà Westron Launcher sul tuo computer.$\r$\n$\r$\nFai clic su Avanti."

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(WESTRON_WELCOME_TITLE)"
  !define MUI_WELCOMEPAGE_TEXT "$(WESTRON_WELCOME_TEXT)"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !insertmacro MUI_PAGE_WELCOME
!macroend
!endif

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "Westron Launcher'ı kaldır"
  !define MUI_UNWELCOMEPAGE_TEXT "Westron Launcher bilgisayarınızdan kaldırılacaktır."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
