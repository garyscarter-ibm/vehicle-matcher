// pg removes its pool error listener while a client is checked out. A socket
// failure also emits a Client error, so catching query rejections is insufficient.
export async function withPostgresClient(pool, work) {
  const client = await pool.connect();
  let failure;
  const onError = (error) => { failure ??= error; };
  const check = () => { if (failure) throw failure; };
  client.on?.('error', onError);
  try {
    const value = await work({
      async query(...args) {
        check();
        const result = await client.query(...args);
        check();
        return result;
      },
    });
    // Work may await something other than a query while it holds the client.
    check();
    return value;
  } finally {
    // Release first: pg reinstalls its idle listener and discards a failed client.
    try { client.release(failure); }
    finally { client.removeListener?.('error', onError); }
  }
}
