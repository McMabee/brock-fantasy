import {
  EMAIL_DELIVERY_ACTION,
  EMAIL_DELIVERY_EXPLANATION,
  EMAIL_DELIVERY_TITLE,
} from '../lib/email-delivery';

// - Render static copy in the server forms without loading the application bundle
export function emailDeliveryNotice(): string {
  return `<aside class="email-delivery-notice" role="note" aria-label="Email delivery reminder"><h2>${EMAIL_DELIVERY_TITLE}</h2><p>${EMAIL_DELIVERY_EXPLANATION} ${EMAIL_DELIVERY_ACTION}</p></aside>`;
}
