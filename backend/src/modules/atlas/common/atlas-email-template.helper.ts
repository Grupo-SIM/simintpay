import { getPlatformIntegrationValue } from '../../platform-integrations/platform-integrations.store';
/**
 * Template central de e-mail Atlashost (visual equivalente ao ÁreaFlix: fundo escuro,
 * logo no topo, container central). Todo e-mail Atlas é envolvido por este shell.
 *
 * O conteúdo interno usa tags comuns (h1, p, a, strong, ul, pre) que são
 * estilizadas pelo <style> escopado em .ae-content.
 */

// Por padrão a logo é anexada inline via CID (renderiza no Gmail sem depender de hosting).
// Pode sobrescrever com uma URL pública via ATLAS_EMAIL_LOGO_URL.
const logoUrl = () => getPlatformIntegrationValue('ATLAS', 'EMAIL_LOGO_URL') || 'cid:atlaslogo';

/** CID usado para anexar a logo inline (ver AtlasMailService). */
export const ATLAS_EMAIL_LOGO_CID = 'atlaslogo';

export function wrapAtlasEmail(innerHtml: string, previewText?: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  .ae-content h1 { font-size: 22px; color: #ffffff; font-weight: 600; text-align: center; margin: 24px 0; }
  .ae-content h2 { font-size: 18px; color: #ffffff; margin: 16px 0 8px; }
  .ae-content p { font-size: 14px; color: #e5e7eb; line-height: 1.6; margin: 10px 0; }
  .ae-content strong { color: #ffffff; }
  .ae-content a { color: #8b9bff; }
  .ae-content ul { color: #e5e7eb; font-size: 14px; padding-left: 18px; }
  .ae-content li { margin: 4px 0; }
  .ae-content hr { border: none; border-top: 1px solid #1f2430; margin: 20px 0; }
  .ae-content pre { background: #111827; color: #e5e7eb; padding: 10px; border-radius: 8px; overflow-x: auto; word-break: break-all; font-size: 12px; }
  .ae-btn { display: inline-block; padding: 10px 20px; background: #ffffff; color: #000000 !important; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none; }
  .ae-tag { display: inline-block; padding: 2px 12px; border: 1px solid #f5872a; background: rgba(232,115,31,0.14); color: #f5872a; border-radius: 9999px; font-size: 13px; font-weight: 700; letter-spacing: .2px; }
</style>
</head>
<body style="margin:0; background:#000000; font-family: Arial, Helvetica, sans-serif;">
  ${previewText ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${previewText}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000; padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="465" cellpadding="0" cellspacing="0" style="width:100%; max-width:465px; background:#0b0b0d; border:1px solid #1f2430; border-radius:14px; padding:28px;">
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <img src="${logoUrl()}" height="44" alt="Atlashost" style="display:block; margin:0 auto; height:44px; width:auto;" />
            </td>
          </tr>
          <tr>
            <td class="ae-content" style="color:#e5e7eb;">
              ${innerHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:24px; color:#6b7280; font-size:12px;">
              Atlashost · SIM Intermediações
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
