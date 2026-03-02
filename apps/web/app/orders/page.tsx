"use client";

import { useEffect, useState } from "react";
import { requireTokenOrRedirect } from "../lib/auth";
import Topbar from "../components/topbar";

const API_BASE = "http://localhost:3001";

type Product = { id: string; ean: string; brand: string; model: string; name: string };
type Channel = { id: string; code: string; name: string };
type Order = {
  id: string;
  orderNumber: string;
  platform: string;
  sourceLabel: string | null;
  status: string;
  paymentStatus: string;
  grossAmountEurFrozen: number;
  netProfitEur: number;
  orderedAt: string;
};

export default function OrdersPage() {
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [orderNumber, setOrderNumber] = useState("");
  const [platform, setPlatform] = useState("Shopify");
  const [sourceChannelId, setSourceChannelId] = useState("");
  const [country, setCountry] = useState("DE");
  const [amount, setAmount] = useState("209");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");

  async function loadAll(currentStoreId: string) {
    const token = requireTokenOrRedirect();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [ordersRes, productsRes, bootstrapRes] = await Promise.all([
        fetch(`${API_BASE}/orders?storeId=${encodeURIComponent(currentStoreId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/products?storeId=${encodeURIComponent(currentStoreId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/stores/${currentStoreId}/bootstrap`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const ordersData = await ordersRes.json();
      const productsData = await productsRes.json();
      const bootstrapData = await bootstrapRes.json();

      if (ordersRes.ok) setOrders(ordersData.orders || []);
      if (productsRes.ok) setProducts(productsData.products || []);
      if (bootstrapRes.ok) setChannels(bootstrapData.channels || []);

      if (!ordersRes.ok) setError(ordersData.error || "Error loading orders");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = requireTokenOrRedirect();
    if (!token) return;
    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId) return;
    setStoreId(selectedStoreId);

    try {
      const storesRaw = localStorage.getItem("stores");
      if (storesRaw) {
        const stores = JSON.parse(storesRaw) as { storeId: string; storeName: string }[];
        setStoreName(stores.find((s) => s.storeId === selectedStoreId)?.storeName || "");
      }
    } catch {}

    loadAll(selectedStoreId);
  }, []);

  async function createOrder(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !orderNumber || !amount || !productId) return;
    const selectedProduct = products.find((p) => p.id === productId);
    const res = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        storeId,
        orderNumber,
        platform,
        sourceChannelId: sourceChannelId || null,
        sourceLabel: channels.find((c) => c.id === sourceChannelId)?.name || null,
        customerCountryCode: country,
        currencyCode: "EUR",
        grossAmountOriginal: amount,
        grossFxToEur: "1",
        feesEur: "8.5",
        cpaEur: "4.2",
        shippingCostEur: "5.9",
        packagingCostEur: "1.2",
        returnCostEur: "0",
        status: "paid",
        paymentStatus: "paid",
        items: [
          {
            productId,
            productEan: selectedProduct?.ean || null,
            title: selectedProduct?.name || "Item",
            quantity: Number(qty || "1"),
            unitPriceOriginal: amount,
            fxToEur: "1",
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Cannot create order");
    setOrderNumber("");
    await loadAll(storeId);
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <Topbar title="Pedidos / Ventas" storeName={storeName} />
        {error ? <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div> : null}

        <div className="bg-white p-4 rounded-2xl shadow-md">
          <h2 className="font-semibold mb-3">Nuevo pedido</h2>
          <form className="grid md:grid-cols-7 gap-2" onSubmit={createOrder}>
            <input
              className="border rounded px-3 py-2"
              placeholder="SO-1169"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              required
            />
            <input className="border rounded px-3 py-2" value={platform} onChange={(e) => setPlatform(e.target.value)} />
            <select className="border rounded px-3 py-2" value={sourceChannelId} onChange={(e) => setSourceChannelId(e.target.value)}>
              <option value="">Canal origen</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input className="border rounded px-3 py-2" value={country} onChange={(e) => setCountry(e.target.value)} />
            <input className="border rounded px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <select className="border rounded px-3 py-2" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Producto</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} {p.model}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input className="border rounded px-3 py-2 w-20" value={qty} onChange={(e) => setQty(e.target.value)} />
              <button className="rounded bg-black text-white px-3 py-2" type="submit">
                Crear
              </button>
            </div>
          </form>
        </div>

        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">Order</th>
                <th className="text-left px-3 py-2">Platform</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Gross EUR</th>
                <th className="text-left px-3 py-2">Profit EUR</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Payment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-gray-500">
                    Cargando...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-gray-500">
                    Sin pedidos
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="border-b">
                    <td className="px-3 py-2">{o.orderNumber}</td>
                    <td className="px-3 py-2">{o.platform}</td>
                    <td className="px-3 py-2">{o.sourceLabel || "-"}</td>
                    <td className="px-3 py-2">{o.grossAmountEurFrozen?.toFixed?.(2) || o.grossAmountEurFrozen}</td>
                    <td className="px-3 py-2">{o.netProfitEur?.toFixed?.(2) || o.netProfitEur}</td>
                    <td className="px-3 py-2">{o.status}</td>
                    <td className="px-3 py-2">{o.paymentStatus}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
