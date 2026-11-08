// The accepted car for the latest order, read the way the account page reads it. Failure leaves the body's "not supplied" line.
import { latestOrderId } from './order-progress-controller.js';

const safeSrc = (value) => typeof value === 'string' && /^(https:\/\/|\/(?!\/))/.test(value) ? value : undefined;

// The car is the selection snapshot for this same order; anything else leaves the body's "not supplied" line.
export function orderCar(order, orderUuid) {
  const stock = order?.status === 'ok' ? order.value?.selection?.stock : null;
  const display = stock?.orderUuid === orderUuid ? stock.facts?.display : null;
  const name = typeof display?.name === 'string' ? display.name.trim() : '';
  return name ? { name, photo: safeSrc(display.photo) ?? safeSrc(display.images?.[0]?.src) } : undefined;
}

export async function loadLatestOrderCar({ listOrders, readOrder, signal } = {}) {
  try {
    const listed = await listOrders?.({ signal });
    const orderUuid = listed?.status === 'ok' ? latestOrderId(listed.value?.orders) : null;
    return orderUuid ? orderCar(await readOrder?.({ signal }), orderUuid) : undefined;
  } catch { return undefined; }
}
