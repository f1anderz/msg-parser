/** Map a Windows codepage number to a TextDecoder label, or null if unsupported. */
export function codepageToLabel(cp: number | null | undefined): string | null {
  if (!cp) return null;
  if (cp === 65001) return 'utf-8';
  if (cp === 65000) return 'utf-7';
  if (cp === 20127) return 'ascii';
  if (cp === 28591) return 'iso-8859-1';
  if (cp === 20866) return 'koi8-r';
  if (cp === 21866) return 'koi8-u';
  if (cp === 932) return 'shift_jis';
  if (cp === 936) return 'gbk';
  if (cp === 949) return 'euc-kr';
  if (cp === 950) return 'big5';
  if (cp >= 1250 && cp <= 1258) return 'windows-' + cp;
  if (cp >= 28592 && cp <= 28606) return 'iso-8859-' + (cp - 28590);
  return null;
}
