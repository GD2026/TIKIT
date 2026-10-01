import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { TikitNative } from './plugin';

/** Native versions of things the web app does in the browser (haptics, share sheet, files, Wallet). */

export function nativeHaptic(kind: 'light' | 'success' | 'warning' | 'error'): void {
  if (kind === 'light') void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  else void Haptics.notification({ type: kind === 'success' ? NotificationType.Success : kind === 'warning' ? NotificationType.Warning : NotificationType.Error }).catch(() => {});
}

export async function nativeShare(data: { title: string; text?: string; url: string }): Promise<'shared' | 'failed'> {
  try {
    await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title });
    return 'shared';
  } catch (err) {
    // Closing the share sheet rejects too; that isn't a failure.
    return /cancel/i.test(String(err)) ? 'shared' : 'failed';
  }
}

/**
 * Files from the app (calendar entry, data export, attendee list) go to the share sheet, where the person
 * can add them to Calendar, save them to Files, or send them on.
 */
export async function nativeSaveText(filename: string, text: string): Promise<void> {
  const written = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: filename, files: [written.uri] });
  } catch (err) {
    if (!/cancel/i.test(String(err))) throw err;
  }
}

/** Apple's «Legg til i Lommebok» sheet for a ticket pass (TikitNativePlugin.swift). */
export async function nativeAddWalletPass(pkpass: Uint8Array): Promise<{ added: boolean }> {
  let binary = '';
  for (let i = 0; i < pkpass.length; i += 0x8000) binary += String.fromCharCode(...pkpass.subarray(i, i + 0x8000));
  return TikitNative.addWalletPass({ data: btoa(binary) });
}

/** Links out of the app (organizer websites, maps, terms on the web) open in an in-app Safari sheet. */
export async function nativeOpenExternal(url: string): Promise<void> {
  await Browser.open({ url, presentationStyle: 'popover' });
}
