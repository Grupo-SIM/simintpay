self.addEventListener("push", event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || !payload.saleId || !Number.isFinite(Number(payload.amount))) return;
  const amount = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(payload.amount));
  event.waitUntil(self.registration.showNotification("Venda aprovada", {
    body: amount,
    tag: `sale-${payload.saleId}`,
    data: { url: "/transacoes" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL("/transacoes", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(url); return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
