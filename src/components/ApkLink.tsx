import { asset } from '../branding';
import { isAndroid, isStandalone } from '../lib/install';

export const APK_PATH = 'download/atisl-security.apk';

/** Link all'app Android (APK): solo su Android e solo se non si è già dentro l'app installata. */
export function ApkLink({ variant = 'link' }: { variant?: 'link' | 'button' }) {
  if (!isAndroid() || isStandalone()) return null;
  return (
    <a
      class={variant === 'button' ? 'btn btn-block apk-link' : 'link-btn apk-link'}
      href={asset(APK_PATH)}
      download="atisl-security.apk"
      type="application/vnd.android.package-archive"
    >
      📱 Scarica l'app per Android (APK)
    </a>
  );
}
