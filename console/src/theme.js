import { createTheme } from '@mui/material/styles'

// Matches src/app.css's `:root` tokens (the launcher's own visual language)
// so the MUI-driven half of the console (Inspector's tabs/toolbar/dialogs)
// reads as the same product as the rest of the launcher, not a bolted-on
// default Material UI theme.
export const MDK_FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const MDK_ORANGE = '#f7931a'

export function buildMuiTheme (dark) {
  return createTheme({
    palette: {
      mode: dark ? 'dark' : 'light',
      primary: { main: MDK_ORANGE, contrastText: '#17130f' },
      ...(dark
        ? {
          background: { default: '#0a0a09', paper: '#17130f' },
          text: { primary: '#f5f5f0', secondary: '#b7b7af' },
          divider: '#26251f'
        }
        : {})
    },
    typography: {
      fontFamily: MDK_FONT,
      button: { textTransform: 'none', fontWeight: 600 }
    },
    shape: { borderRadius: 4 },
    components: {
      MuiButton: {
        styleOverrides: {
          root: { fontFamily: MDK_FONT }
        }
      }
    }
  })
}
