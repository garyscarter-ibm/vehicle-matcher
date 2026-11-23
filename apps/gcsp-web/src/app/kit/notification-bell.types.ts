export interface NotificationRow {
  readonly key: string;
  readonly kind: 'offer';
  readonly waiting?: boolean;
  readonly title: string;
  readonly car?: string;
  readonly detail?: string;
  readonly image?: { readonly src: string };
  readonly action: { readonly label: string; readonly href: string; readonly variant: 'button' | 'link' } | null;
}
export interface NotificationNote { readonly id: string; readonly title: string; readonly text: string }
export interface NotificationModel {
  readonly status: 'ok' | 'unavailable' | 'loading';
  readonly waiting: number;
  readonly rows: readonly NotificationRow[];
  readonly note: NotificationNote | null;
}
export const emptyNotifications = (status: NotificationModel['status'] = 'loading'): NotificationModel => ({ status, waiting: 0, rows: [], note: null });
