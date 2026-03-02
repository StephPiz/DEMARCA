"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Topbar from "../components/topbar";
import { requireTokenOrRedirect } from "../lib/auth";
import { useStorePermissions } from "../lib/access";

const API_BASE = "http://localhost:3001";

type Supplier = { id: string; code: string; name: string };
type Warehouse = { id: string; code: string; name: string };
type Purchase = {
  id: string;
  poNumber: string;
  status: string;
  orderedAt: string;
  totalAmountEur: number;
  supplier: Supplier;
};

type Product = { id: string; ean: string; brand: string; model: string; name: string };

export default function PurchasesPage() {
  const { loading, storeId, storeName, permissions, error: permissionsError } = useStorePermissions();
  const [error, setError] = useState("");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [poNumber, setPoNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("1200");
  const [currency, setCurrency] = useState("TRY");
  const [fx, setFx] = useState("0.092");
  const [receiveWarehouseId, setReceiveWarehouseId] = useState("");
  const [receivingPurchaseId, setReceivingPurchaseId] = useState("");

  const loadAll = useCallback(async (currentStoreId: string) => {
    const token = requireTokenOrRedirect();
    if (!token) return;
    setError("");
    try {
      const [pRes, sRes, prRes, bRes] = await Promise.all([
        fetch(`${API_BASE}/purchases?storeId=${encodeURIComponent(currentStoreId)}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/suppliers?storeId=${encodeURIComponent(currentStoreId)}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/products?storeId=${encodeURIComponent(currentStoreId)}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/stores/${currentStoreId}/bootstrap`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const pData = await pRes.json();
      const sData = await sRes.json();
      const prData = await prRes.json();
      const bData = await bRes.json();

      if (pRes.ok) setPurchases(pData.purchases || []);
      else setError(pData.error || "Error loading purchases");
      if (sRes.ok) setSuppliers(sData.suppliers || []);
      if (prRes.ok) setProducts(prData.products || []);
      if (bRes.ok) {
        const nextWarehouses = bData.warehouses || [];
        setWarehouses(nextWarehouses);
        if (!receiveWarehouseId && nextWarehouses.length > 0) {
          setReceiveWarehouseId(nextWarehouses[0].id);
        }
      }
    } catch {
      setError("Connection error");
    }
  }, [receiveWarehouseId]);

  useEffect(() => {
    if (loading) return;
    if (!storeId || !permissions.financeRead) return;
    queueMicrotask(() => {
      void loadAll(storeId);
    });
  }, [loading, storeId, permissions.financeRead, loadAll]);

  async function createPurchase(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !poNumber || !supplierId || !productId) return;

    const p = products.find((x) => x.id === productId);
    const res = await fetch(`${API_BASE}/purchases`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        storeId,
        supplierId,
        poNumber,
        items: [
          {
            productId,
            title: p?.name || `${p?.brand || ""} ${p?.model || ""}`.trim(),
            ean: p?.ean || null,
            quantityOrdered: Number(qty),
            unitCostOriginal: Number(unitCost),
            currencyCode: currency,
            fxToEur: Number(fx),
          },
        ],
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Cannot create purchase");

    setPoNumber("");
    await loadAll(storeId);
  }

  async function receivePurchase(purchaseId: string) {
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !receiveWarehouseId) return;
    setReceivingPurchaseId(purchaseId);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/purchases/${purchaseId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeId, warehouseId: receiveWarehouseId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo recibir PO");
        return;
      }
      await loadAll(storeId);
    } catch {
      setError("Connection error");
    } finally {
      setReceivingPurchaseId("");
    }
  }

  if (loading) return <div className="min-h-screen bg-gray-100 p-6">Cargando permisos...</div>;
  if (permissionsError) return <div className="min-h-screen bg-gray-100 p-6 text-red-700">{permissionsError}</div>;
  if (!permissions.financeRead) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-3xl mx-auto bg-white p-4 rounded-2xl shadow-md">No autorizado para Compras.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <Topbar title="Compras (PO)" storeName={storeName} />
        {error ? <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div> : null}

        <div className="bg-white p-4 rounded-2xl shadow-md">
          <h2 className="font-semibold mb-3">Nuevo PO</h2>
          <form className="grid md:grid-cols-8 gap-2" onSubmit={createPurchase}>
            <input className="border rounded px-3 py-2" placeholder="PO-2026-0002" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} required />
            <select className="border rounded px-3 py-2" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Proveedor</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select className="border rounded px-3 py-2" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Producto</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.brand} {p.model}</option>
              ))}
            </select>
            <input className="border rounded px-3 py-2" value={qty} onChange={(e) => setQty(e.target.value)} />
            <input className="border rounded px-3 py-2" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            <input className="border rounded px-3 py-2" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            <input className="border rounded px-3 py-2" value={fx} onChange={(e) => setFx(e.target.value)} />
            <button className="rounded bg-black text-white px-3 py-2" type="submit">Crear</button>
          </form>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-md">
          <h2 className="font-semibold mb-2">Recepción de PO</h2>
          <select className="border rounded px-3 py-2" value={receiveWarehouseId} onChange={(e) => setReceiveWarehouseId(e.target.value)}>
            <option value="">Selecciona almacén</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} - {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">PO</th>
                <th className="text-left px-3 py-2">Proveedor</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Total EUR</th>
                <th className="text-left px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-4 text-gray-500">Sin POs</td></tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="px-3 py-2">{p.poNumber}</td>
                    <td className="px-3 py-2">{p.supplier?.name || "-"}</td>
                    <td className="px-3 py-2">{p.status}</td>
                    <td className="px-3 py-2">{new Date(p.orderedAt).toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-2">{p.totalAmountEur}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded border px-2 py-1 disabled:opacity-50"
                          disabled={!receiveWarehouseId || receivingPurchaseId === p.id}
                          onClick={() => receivePurchase(p.id)}
                        >
                          {receivingPurchaseId === p.id ? "..." : "Recibir"}
                        </button>
                        <Link className="rounded border px-2 py-1" href={`/store/purchases/${p.id}`}>
                          Detalle
                        </Link>
                      </div>
                    </td>
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
