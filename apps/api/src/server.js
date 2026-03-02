const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const [type, token] = auth.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing Bearer token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    req.user = payload;
    return next();
  } catch (_e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function getStoreMembership(userId, storeId) {
  return prisma.userStoreMembership.findFirst({
    where: { userId, storeId },
    select: { id: true, roleKey: true },
  });
}

async function canReadSensitive(userId, storeId, roleKey) {
  if (["admin", "admin_ste", "owner"].includes(String(roleKey || "").toLowerCase())) {
    return true;
  }

  const financePermission = await prisma.userPermission.findFirst({
    where: {
      userId,
      storeId,
      granted: true,
      permission: { key: "finance.read" },
    },
    select: { id: true },
  });

  return Boolean(financePermission);
}

async function hasPermission(userId, storeId, permissionKey) {
  const permission = await prisma.userPermission.findFirst({
    where: {
      userId,
      storeId,
      granted: true,
      permission: { key: permissionKey },
    },
    select: { id: true },
  });

  return Boolean(permission);
}

async function canManageCatalog(userId, storeId, roleKey) {
  if (["admin", "admin_ste", "owner"].includes(String(roleKey || "").toLowerCase())) return true;
  return hasPermission(userId, storeId, "products.write");
}

async function canManageOrders(userId, storeId, roleKey) {
  if (["admin", "admin_ste", "owner", "ops"].includes(String(roleKey || "").toLowerCase())) return true;
  return hasPermission(userId, storeId, "orders.write");
}

async function canManagePayouts(userId, storeId, roleKey) {
  if (["admin", "admin_ste", "owner"].includes(String(roleKey || "").toLowerCase())) return true;
  return hasPermission(userId, storeId, "payouts.write");
}

async function canManageInvoices(userId, storeId, roleKey) {
  if (["admin", "admin_ste", "owner"].includes(String(roleKey || "").toLowerCase())) return true;
  return hasPermission(userId, storeId, "invoices.write");
}

function normalizeMoney(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Number((Number(value || 0)).toFixed(2));
}

const ORDER_STATUSES = new Set(["pending", "paid", "packed", "shipped", "delivered", "returned", "cancelled"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partially_paid", "paid"]);
const ORDER_STATUS_FLOW = {
  pending: new Set(["paid", "cancelled"]),
  paid: new Set(["packed", "cancelled", "returned"]),
  packed: new Set(["shipped", "cancelled", "returned"]),
  shipped: new Set(["delivered", "returned"]),
  delivered: new Set(["returned"]),
  returned: new Set([]),
  cancelled: new Set([]),
};
const PAYMENT_STATUS_FLOW = {
  unpaid: new Set(["partially_paid", "paid"]),
  partially_paid: new Set(["paid"]),
  paid: new Set([]),
};

function isPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function parseDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCurrencyCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return code;
}

async function nextInvoiceNumber(tx, storeId) {
  const store = await tx.store.findUnique({
    where: { id: storeId },
    select: { id: true, invoicePrefix: true, invoiceSequenceNext: true },
  });
  if (!store) throw new Error("Store not found");

  const sequence = Number(store.invoiceSequenceNext || 1);
  const prefix = store.invoicePrefix || "INV";
  const number = `${prefix}-${String(sequence).padStart(6, "0")}`;

  await tx.store.update({
    where: { id: storeId },
    data: { invoiceSequenceNext: sequence + 1 },
  });

  return number;
}

async function generateInternalEan(storeId) {
  const count = await prisma.product.count({ where: { storeId, isInternalEan: true } });
  const next = String(count + 1).padStart(6, "0");
  return `INT-${next}`;
}

async function findProductByScan(storeId, scanCode) {
  const trimmed = String(scanCode || "").trim();
  if (!trimmed) return null;

  const byEan = await prisma.product.findFirst({
    where: { storeId, ean: trimmed },
    select: { id: true, ean: true, brand: true, model: true, name: true, status: true },
  });

  if (byEan) return { product: byEan, via: "ean" };

  const alias = await prisma.eanAlias.findFirst({
    where: { storeId, ean: trimmed },
    include: {
      product: {
        select: { id: true, ean: true, brand: true, model: true, name: true, status: true },
      },
    },
  });

  if (!alias) return null;
  return { product: alias.product, via: "alias", alias: alias.ean };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const memberships = await prisma.userStoreMembership.findMany({
      where: { userId: user.id },
      include: { store: { include: { holding: true } } },
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email, locale: user.preferredLocale },
      process.env.JWT_SECRET || "dev-secret",
      { expiresIn: "2h" }
    );

    return res.json({
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        preferredLocale: user.preferredLocale,
      },
      stores: memberships.map((m) => ({
        roleKey: m.roleKey,
        storeId: m.storeId,
        storeCode: m.store.code,
        storeName: m.store.name,
        holdingId: m.store.holdingId,
        holdingName: m.store.holding.name,
      })),
    });
  } catch (err) {
    console.error("POST /auth/login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, preferredLocale: true, isActive: true },
    });

    const memberships = await prisma.userStoreMembership.findMany({
      where: { userId },
      include: { store: { include: { holding: true } } },
    });

    return res.json({
      user,
      stores: memberships.map((m) => ({
        roleKey: m.roleKey,
        storeId: m.storeId,
        storeCode: m.store.code,
        storeName: m.store.name,
        holdingId: m.store.holdingId,
        holdingName: m.store.holding.name,
      })),
    });
  } catch (err) {
    console.error("GET /me error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/holdings", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const memberships = await prisma.userStoreMembership.findMany({
      where: { userId },
      include: { store: { include: { holding: true } } },
    });

    const byId = new Map();
    for (const m of memberships) {
      byId.set(m.store.holding.id, { id: m.store.holding.id, name: m.store.holding.name });
    }

    return res.json({ holdings: Array.from(byId.values()) });
  } catch (err) {
    console.error("GET /holdings error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/stores", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const holdingId = String(req.query.holdingId || "").trim();

    const memberships = await prisma.userStoreMembership.findMany({
      where: { userId },
      include: { store: true },
    });

    const stores = memberships
      .map((m) => ({
        roleKey: m.roleKey,
        storeId: m.storeId,
        holdingId: m.store.holdingId,
        storeCode: m.store.code,
        storeName: m.store.name,
        status: m.store.status,
      }))
      .filter((s) => (!holdingId ? true : s.holdingId === holdingId));

    return res.json({ stores });
  } catch (err) {
    console.error("GET /stores error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/stores/:storeId/bootstrap", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId } = req.params;

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const [store, warehouses, channels] = await Promise.all([
      prisma.store.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          description: true,
          logoUrl: true,
          baseCurrencyCode: true,
          invoicePrefix: true,
        },
      }),
      prisma.warehouse.findMany({
        where: { storeId, status: "active" },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      }),
      prisma.salesChannel.findMany({
        where: { storeId },
        orderBy: { name: "asc" },
      }),
    ]);

    return res.json({ store, roleKey: membership.roleKey, warehouses, channels });
  } catch (err) {
    console.error("GET /stores/:storeId/bootstrap error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/stores/:storeId/permissions", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId } = req.params;

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const [canSensitive, canCatalogWrite, canOrdersWrite, canPayoutsWrite, canInvoicesWrite] = await Promise.all([
      canReadSensitive(userId, storeId, membership.roleKey),
      canManageCatalog(userId, storeId, membership.roleKey),
      canManageOrders(userId, storeId, membership.roleKey),
      canManagePayouts(userId, storeId, membership.roleKey),
      canManageInvoices(userId, storeId, membership.roleKey),
    ]);

    return res.json({
      roleKey: membership.roleKey,
      permissions: {
        inventoryRead: true,
        inventoryWrite: ["admin", "admin_ste", "owner", "warehouse", "ops"].includes(
          String(membership.roleKey).toLowerCase()
        ),
        catalogWrite: canCatalogWrite,
        ordersWrite: canOrdersWrite,
        payoutsWrite: canPayoutsWrite,
        invoicesWrite: canInvoicesWrite,
        financeRead: canSensitive,
        suppliersRead: canSensitive,
      },
    });
  } catch (err) {
    console.error("GET /stores/:storeId/permissions error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/stores/:storeId/warehouses", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId } = req.params;

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const warehouses = await prisma.warehouse.findMany({
      where: { storeId },
      include: { locations: { where: { isActive: true }, orderBy: { code: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });

    return res.json({ warehouses });
  } catch (err) {
    console.error("GET /stores/:storeId/warehouses error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/stores/:storeId/warehouses", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId } = req.params;
    const { code, name, country, type, status, isDefault } = req.body || {};

    if (!code || !name) return res.status(400).json({ error: "Missing code or name" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage warehouses" });

    const warehouse = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.warehouse.updateMany({ where: { storeId, isDefault: true }, data: { isDefault: false } });
      }

      return tx.warehouse.create({
        data: {
          storeId,
          code: String(code).trim().toUpperCase(),
          name: String(name).trim(),
          country: country ? String(country).trim().toUpperCase() : null,
          type: type || "own",
          status: status || "active",
          isDefault: Boolean(isDefault),
        },
      });
    });

    return res.status(201).json({ warehouse });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Warehouse code already exists" });
    console.error("POST /stores/:storeId/warehouses error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/stores/:storeId/warehouses/:warehouseId/locations", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId, warehouseId } = req.params;
    const { code, name } = req.body || {};

    if (!code) return res.status(400).json({ error: "Missing code" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage locations" });

    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, storeId }, select: { id: true } });
    if (!warehouse) return res.status(404).json({ error: "Warehouse not found" });

    const location = await prisma.warehouseLocation.create({
      data: {
        warehouseId,
        code: String(code).trim().toUpperCase(),
        name: name ? String(name).trim() : null,
      },
    });

    return res.status(201).json({ location });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Location code already exists" });
    console.error("POST /stores/:storeId/warehouses/:warehouseId/locations error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/stores/:storeId/channels", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId } = req.params;

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const channels = await prisma.salesChannel.findMany({
      where: { storeId },
      orderBy: { name: "asc" },
    });
    return res.json({ channels });
  } catch (err) {
    console.error("GET /stores/:storeId/channels error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/stores/:storeId/channels", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId } = req.params;
    const { code, name, type, status, feePercent, cpaFixed, payoutTerms } = req.body || {};

    if (!code || !name || !type) return res.status(400).json({ error: "Missing code, name or type" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage channels" });

    const channel = await prisma.salesChannel.create({
      data: {
        storeId,
        code: String(code).trim().toUpperCase(),
        name: String(name).trim(),
        type,
        status: status || "active",
        feePercent: feePercent ?? null,
        cpaFixed: cpaFixed ?? null,
        payoutTerms: payoutTerms || null,
      },
    });

    return res.status(201).json({ channel });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ error: "Channel code already exists" });
    console.error("POST /stores/:storeId/channels error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/inventory", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const storeId = String(req.query.storeId || "").trim();
    const warehouseId = String(req.query.warehouseId || "").trim() || null;
    const q = String(req.query.q || "").trim();
    const withImages = String(req.query.withImages || "0") === "1";

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const products = await prisma.product.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { brand: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
                { ean: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ brand: "asc" }, { model: "asc" }],
      take: 200,
      select: {
        id: true,
        type: true,
        brand: true,
        model: true,
        name: true,
        ean: true,
        status: true,
        mainImageUrl: true,
      },
    });

    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) {
      return res.json({ items: [] });
    }

    const lots = await prisma.inventoryLot.findMany({
      where: {
        storeId,
        productId: { in: productIds },
        quantityAvailable: { gt: 0 },
      },
      select: {
        productId: true,
        warehouseId: true,
        quantityAvailable: true,
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });

    const stockByProduct = new Map();
    for (const lot of lots) {
      const key = lot.productId;
      if (!stockByProduct.has(key)) {
        stockByProduct.set(key, { total: 0, selected: 0, warehouses: new Map() });
      }

      const row = stockByProduct.get(key);
      row.total += Number(lot.quantityAvailable);

      const wh = row.warehouses;
      const currentWh = wh.get(lot.warehouseId) || {
        warehouseId: lot.warehouse.id,
        warehouseCode: lot.warehouse.code,
        warehouseName: lot.warehouse.name,
        qty: 0,
      };
      currentWh.qty += Number(lot.quantityAvailable);
      wh.set(lot.warehouseId, currentWh);

      if (!warehouseId || lot.warehouseId === warehouseId) {
        row.selected += Number(lot.quantityAvailable);
      }
    }

    return res.json({
      items: products.map((p) => {
        const stock = stockByProduct.get(p.id) || { total: 0, selected: 0, warehouses: new Map() };
        const byWarehouse = Array.from(stock.warehouses.values());

        const availableElsewhere = byWarehouse.filter((w) => {
          if (!warehouseId) return false;
          return w.warehouseId !== warehouseId && w.qty > 0;
        });

        return {
          id: p.id,
          type: p.type,
          brand: p.brand,
          model: p.model,
          name: p.name,
          ean: p.ean,
          status: p.status,
          imageUrl: withImages ? p.mainImageUrl : null,
          stockSelectedWarehouse: warehouseId ? stock.selected : stock.total,
          stockTotalStore: stock.total,
          stockByWarehouse: byWarehouse,
          availableElsewhere,
        };
      }),
    });
  } catch (err) {
    console.error("GET /inventory error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/products", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const storeId = String(req.query.storeId || "").trim();
    const q = String(req.query.q || "").trim();

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const products = await prisma.product.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { brand: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
                { ean: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        ean: true,
        sku: true,
        type: true,
        brand: true,
        model: true,
        name: true,
        status: true,
        mainImageUrl: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
    });

    return res.json({ products });
  } catch (err) {
    console.error("GET /products error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/scan/lookup", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId, code } = req.body || {};

    if (!storeId || !code) {
      return res.status(400).json({ error: "Missing storeId or code" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const found = await findProductByScan(storeId, code);
    if (!found) {
      const suggestedInternalEan = await generateInternalEan(storeId);
      return res.status(404).json({
        found: false,
        code,
        suggestedActions: ["create_product", "generate_internal_ean"],
        suggestedInternalEan,
      });
    }

    return res.json({ found: true, via: found.via, product: found.product, alias: found.alias || null });
  } catch (err) {
    console.error("POST /scan/lookup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/products", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      storeId,
      ean,
      sku,
      type,
      brand,
      model,
      name,
      status,
      internalDescription,
      attributes,
      mainImageUrl,
    } = req.body || {};

    if (!storeId || !brand || !model) {
      return res.status(400).json({ error: "Missing storeId, brand or model" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const finalEan = ean ? String(ean).trim() : await generateInternalEan(storeId);
    const finalName = name ? String(name).trim() : `${brand} ${model}`;
    const isInternalEan = !ean;

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage products" });

    const product = await prisma.product.create({
      data: {
        storeId,
        ean: finalEan,
        sku: sku || null,
        type: type || "other",
        brand,
        model,
        name: finalName,
        status: status || "active",
        isInternalEan,
        internalDescription: internalDescription || null,
        attributes: attributes || null,
        mainImageUrl: mainImageUrl || null,
      },
    });

    return res.status(201).json({ product });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "EAN already exists in store" });
    }
    console.error("POST /products error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.put("/products/:productId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId } = req.params;
    const { storeId, ean, sku, type, brand, model, name, status, internalDescription, attributes, mainImageUrl } =
      req.body || {};

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage products" });

    const existing = await prisma.product.findFirst({ where: { id: productId, storeId } });
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        ean: ean ? String(ean).trim() : existing.ean,
        sku: sku || null,
        type: type || existing.type,
        brand: brand || existing.brand,
        model: model || existing.model,
        name: name || `${brand || existing.brand} ${model || existing.model}`,
        status: status || existing.status,
        internalDescription: internalDescription ?? null,
        attributes: attributes ?? null,
        mainImageUrl: mainImageUrl ?? null,
      },
    });

    return res.json({ product });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ error: "EAN already exists in store" });
    console.error("PUT /products/:productId error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/products/:productId/ean-aliases", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId } = req.params;
    const { storeId, ean, source, note } = req.body || {};

    if (!storeId || !ean) return res.status(400).json({ error: "Missing storeId or ean" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage products" });

    const product = await prisma.product.findFirst({ where: { id: productId, storeId }, select: { id: true } });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const alias = await prisma.eanAlias.create({
      data: {
        storeId,
        productId,
        ean: String(ean).trim(),
        source: source || "manual",
        note: note || null,
      },
    });
    return res.status(201).json({ alias });
  } catch (err) {
    if (err?.code === "P2002") return res.status(409).json({ error: "EAN alias already exists in store" });
    console.error("POST /products/:productId/ean-aliases error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.delete("/products/:productId/ean-aliases/:aliasId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId, aliasId } = req.params;
    const storeId = String(req.query.storeId || "").trim();

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage products" });

    const alias = await prisma.eanAlias.findFirst({ where: { id: aliasId, productId, storeId }, select: { id: true } });
    if (!alias) return res.status(404).json({ error: "EAN alias not found" });

    await prisma.eanAlias.delete({ where: { id: aliasId } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /products/:productId/ean-aliases/:aliasId error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.put("/products/:productId/channel/:channelId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId, channelId } = req.params;
    const { storeId, listingStatus, publicName, channelEan, listingUrl, priceOriginal, priceCurrencyCode, priceFxToEur } =
      req.body || {};

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage products" });

    const [product, channel] = await Promise.all([
      prisma.product.findFirst({ where: { id: productId, storeId }, select: { id: true } }),
      prisma.salesChannel.findFirst({ where: { id: channelId, storeId }, select: { id: true } }),
    ]);
    if (!product || !channel) return res.status(404).json({ error: "Product or channel not found" });

    const fx = priceFxToEur ? Number(priceFxToEur) : null;
    const price = priceOriginal ? Number(priceOriginal) : null;
    const frozen = price !== null && fx !== null ? Number((price * fx).toFixed(2)) : null;

    const listing = await prisma.productChannel.upsert({
      where: { productId_channelId: { productId, channelId } },
      update: {
        listingStatus: listingStatus || "active",
        publicName: publicName || null,
        channelEan: channelEan || null,
        listingUrl: listingUrl || null,
        priceOriginal: price !== null ? String(price) : null,
        priceCurrencyCode: priceCurrencyCode || null,
        priceFxToEur: fx !== null ? String(fx) : null,
        priceEurFrozen: frozen !== null ? String(frozen) : null,
      },
      create: {
        productId,
        channelId,
        listingStatus: listingStatus || "active",
        publicName: publicName || null,
        channelEan: channelEan || null,
        listingUrl: listingUrl || null,
        priceOriginal: price !== null ? String(price) : null,
        priceCurrencyCode: priceCurrencyCode || null,
        priceFxToEur: fx !== null ? String(fx) : null,
        priceEurFrozen: frozen !== null ? String(frozen) : null,
      },
    });

    return res.json({ listing });
  } catch (err) {
    console.error("PUT /products/:productId/channel/:channelId error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.put("/products/:productId/texts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId } = req.params;
    const { storeId, locale, channelId, publicName, description } = req.body || {};

    if (!storeId || !locale || !publicName) {
      return res.status(400).json({ error: "Missing storeId, locale or publicName" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageCatalog(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage products" });

    const product = await prisma.product.findFirst({ where: { id: productId, storeId }, select: { id: true } });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const text = await prisma.productText.upsert({
      where: {
        productId_locale_channelId: {
          productId,
          locale: String(locale).trim().toLowerCase(),
          channelId: channelId || null,
        },
      },
      update: {
        publicName: String(publicName).trim(),
        description: description || null,
      },
      create: {
        storeId,
        productId,
        locale: String(locale).trim().toLowerCase(),
        channelId: channelId || null,
        publicName: String(publicName).trim(),
        description: description || null,
      },
    });

    return res.json({ text });
  } catch (err) {
    console.error("PUT /products/:productId/texts error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/inventory/receive", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      storeId,
      productId,
      warehouseId,
      locationId,
      lotCode,
      sourceType,
      supplierName,
      purchasedAt,
      quantity,
      unitCostOriginal,
      costCurrencyCode,
      fxToEur,
      note,
    } = req.body || {};

    if (!storeId || !productId || !warehouseId || !quantity || !unitCostOriginal || !costCurrencyCode || !fxToEur) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (Number(quantity) <= 0) return res.status(400).json({ error: "quantity must be > 0" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const computedEur = Number(unitCostOriginal) * Number(fxToEur);
    const finalLotCode = lotCode || `LOT-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;

    const result = await prisma.$transaction(async (tx) => {
      const lot = await tx.inventoryLot.create({
        data: {
          storeId,
          productId,
          warehouseId,
          locationId: locationId || null,
          lotCode: finalLotCode,
          sourceType: sourceType || "manual_receipt",
          supplierName: supplierName || null,
          purchasedAt: purchasedAt ? new Date(purchasedAt) : null,
          quantityReceived: Number(quantity),
          quantityAvailable: Number(quantity),
          unitCostOriginal: String(unitCostOriginal),
          costCurrencyCode,
          fxToEur: String(fxToEur),
          unitCostEurFrozen: String(computedEur.toFixed(4)),
          note: note || null,
        },
      });

      const movement = await tx.inventoryMovement.create({
        data: {
          storeId,
          productId,
          lotId: lot.id,
          warehouseId,
          movementType: "receive_in",
          quantity: Number(quantity),
          unitCostEurFrozen: lot.unitCostEurFrozen,
          referenceType: "manual_receipt",
          referenceId: lot.id,
          reason: note || "Manual receive",
          createdByUserId: userId,
        },
      });

      return { lot, movement };
    });

    return res.status(201).json({
      lot: {
        ...result.lot,
        unitCostOriginal: normalizeMoney(result.lot.unitCostOriginal),
        fxToEur: normalizeMoney(result.lot.fxToEur),
        unitCostEurFrozen: normalizeMoney(result.lot.unitCostEurFrozen),
      },
      movement: result.movement,
    });
  } catch (err) {
    console.error("POST /inventory/receive error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/inventory/out", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId, productId, warehouseId, quantity, referenceType, referenceId, reason } = req.body || {};

    if (!storeId || !productId || !warehouseId || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const qtyNeeded = Number(quantity);
    if (!Number.isInteger(qtyNeeded) || qtyNeeded <= 0) {
      return res.status(400).json({ error: "quantity must be a positive integer" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const result = await prisma.$transaction(async (tx) => {
      const lots = await tx.inventoryLot.findMany({
        where: {
          storeId,
          productId,
          warehouseId,
          quantityAvailable: { gt: 0 },
          status: "available",
        },
        orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
      });

      const totalAvailable = lots.reduce((sum, l) => sum + Number(l.quantityAvailable), 0);
      if (totalAvailable < qtyNeeded) {
        return {
          error: {
            code: "INSUFFICIENT_STOCK",
            available: totalAvailable,
            requested: qtyNeeded,
          },
        };
      }

      let remaining = qtyNeeded;
      const consumedLots = [];

      for (const lot of lots) {
        if (remaining <= 0) break;
        const current = Number(lot.quantityAvailable);
        if (current <= 0) continue;

        const used = Math.min(current, remaining);
        remaining -= used;

        const updated = await tx.inventoryLot.update({
          where: { id: lot.id },
          data: { quantityAvailable: current - used },
        });

        const movement = await tx.inventoryMovement.create({
          data: {
            storeId,
            productId,
            lotId: lot.id,
            warehouseId,
            movementType: "sale_out",
            quantity: -used,
            unitCostEurFrozen: lot.unitCostEurFrozen,
            referenceType: referenceType || "order",
            referenceId: referenceId || null,
            reason: reason || "Sale / picking",
            createdByUserId: userId,
          },
        });

        consumedLots.push({
          lotId: lot.id,
          lotCode: lot.lotCode,
          consumed: used,
          before: current,
          after: Number(updated.quantityAvailable),
          unitCostEurFrozen: normalizeMoney(lot.unitCostEurFrozen),
          movementId: movement.id,
        });
      }

      return { consumedLots };
    });

    if (result.error) {
      return res.status(409).json({ error: result.error.code, ...result.error });
    }

    return res.json({ ok: true, consumedLots: result.consumedLots });
  } catch (err) {
    console.error("POST /inventory/out error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/orders", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const storeId = String(req.query.storeId || "").trim();
    const q = String(req.query.q || "").trim();

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canSensitive = await canReadSensitive(userId, storeId, membership.roleKey);

    const orders = await prisma.salesOrder.findMany({
      where: {
        storeId,
        ...(q
          ? {
              OR: [
                { orderNumber: { contains: q, mode: "insensitive" } },
                { platform: { contains: q, mode: "insensitive" } },
                { sourceLabel: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        sourceChannel: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, fullName: true, email: true, country: true } },
        items: { select: { id: true, quantity: true, title: true, revenueEurFrozen: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: { orderedAt: "desc" },
      take: 200,
    });

    return res.json({
      orders: orders.map((o) => ({
        ...o,
        grossAmountOriginal: canSensitive ? normalizeMoney(o.grossAmountOriginal) : null,
        grossFxToEur: canSensitive ? normalizeMoney(o.grossFxToEur) : null,
        grossAmountEurFrozen: canSensitive ? normalizeMoney(o.grossAmountEurFrozen) : null,
        feesEur: canSensitive ? normalizeMoney(o.feesEur) : null,
        cpaEur: canSensitive ? normalizeMoney(o.cpaEur) : null,
        shippingCostEur: canSensitive ? normalizeMoney(o.shippingCostEur) : null,
        packagingCostEur: canSensitive ? normalizeMoney(o.packagingCostEur) : null,
        returnCostEur: canSensitive ? normalizeMoney(o.returnCostEur) : null,
        cogsEur: canSensitive ? normalizeMoney(o.cogsEur) : null,
        netProfitEur: canSensitive ? normalizeMoney(o.netProfitEur) : null,
        items: o.items.map((it) => ({
          ...it,
          revenueEurFrozen: canSensitive ? normalizeMoney(it.revenueEurFrozen) : null,
        })),
      })),
    });
  } catch (err) {
    console.error("GET /orders error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

  app.post("/orders", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      storeId,
      orderNumber,
      platform,
      sourceChannelId,
      sourceLabel,
      customer,
      customerCountryCode,
      currencyCode,
      grossAmountOriginal,
      grossFxToEur,
      feesEur,
      cpaEur,
      shippingCostEur,
      packagingCostEur,
      returnCostEur,
      status,
      paymentStatus,
      orderedAt,
      items,
    } = req.body || {};

    if (!storeId || !orderNumber || !platform || !currencyCode || !grossAmountOriginal || !grossFxToEur) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Order must include at least one item" });
    }
    if (!isPositiveNumber(grossAmountOriginal) || !isPositiveNumber(grossFxToEur)) {
      return res.status(400).json({ error: "grossAmountOriginal and grossFxToEur must be positive numbers" });
    }
    if (![feesEur, cpaEur, shippingCostEur, packagingCostEur, returnCostEur].every((v) => v === undefined || isNonNegativeNumber(v))) {
      return res.status(400).json({ error: "Cost fields must be non-negative numbers" });
    }
    if (status && !ORDER_STATUSES.has(String(status))) {
      return res.status(400).json({ error: "Invalid order status" });
    }
    if (paymentStatus && !PAYMENT_STATUSES.has(String(paymentStatus))) {
      return res.status(400).json({ error: "Invalid payment status" });
    }
    const parsedOrderDate = orderedAt ? parseDateInput(orderedAt) : new Date();
    if (!parsedOrderDate) {
      return res.status(400).json({ error: "Invalid orderedAt date" });
    }
    const parsedCurrency = parseCurrencyCode(currencyCode);
    if (!parsedCurrency) {
      return res.status(400).json({ error: "Invalid currencyCode format (expected ISO-4217 like EUR)" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const canWrite = await canManageOrders(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage orders" });

    if (sourceChannelId) {
      const channel = await prisma.salesChannel.findFirst({
        where: { id: sourceChannelId, storeId },
        select: { id: true },
      });
      if (!channel) return res.status(400).json({ error: "Invalid sourceChannelId for this store" });
    }

    const duplicateItemIds = new Set();
    for (const it of items) {
      if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) <= 0) {
        return res.status(400).json({ error: "Each item quantity must be a positive integer" });
      }
      if (!isPositiveNumber(it.unitPriceOriginal || 0)) {
        return res.status(400).json({ error: "Each item unitPriceOriginal must be positive" });
      }
      if (it.fxToEur !== undefined && !isPositiveNumber(it.fxToEur)) {
        return res.status(400).json({ error: "Each item fxToEur must be positive when provided" });
      }
      if (it.productId) {
        if (duplicateItemIds.has(it.productId)) {
          return res.status(400).json({ error: "Duplicate productId in order items is not allowed" });
        }
        duplicateItemIds.add(it.productId);
      }
    }

    const grossEurFrozen = roundMoney(numberOrZero(grossAmountOriginal) * numberOrZero(grossFxToEur));
    const fees = numberOrZero(feesEur);
    const cpa = numberOrZero(cpaEur);
    const shipping = numberOrZero(shippingCostEur);
    const packaging = numberOrZero(packagingCostEur);
    const returns = numberOrZero(returnCostEur);

    const order = await prisma.$transaction(async (tx) => {
      let customerId = null;
      if (customer && (customer.email || customer.fullName)) {
        const found = customer.email
          ? await tx.customer.findFirst({ where: { storeId, email: String(customer.email).trim() }, select: { id: true } })
          : null;

        if (found) {
          customerId = found.id;
          await tx.customer.update({
            where: { id: found.id },
            data: {
              fullName: customer.fullName || null,
              country: customer.country || null,
              city: customer.city || null,
            },
          });
        } else {
          const created = await tx.customer.create({
            data: {
              storeId,
              email: customer.email || null,
              fullName: customer.fullName || null,
              country: customer.country || null,
              city: customer.city || null,
            },
          });
          customerId = created.id;
        }
      }

      const createdOrder = await tx.salesOrder.create({
        data: {
          storeId,
          orderNumber: String(orderNumber).trim(),
          platform: String(platform).trim(),
          sourceChannelId: sourceChannelId || null,
          sourceLabel: sourceLabel || null,
          customerId,
          customerCountryCode: customerCountryCode || null,
          currencyCode: parsedCurrency,
          grossAmountOriginal: String(grossAmountOriginal),
          grossFxToEur: String(grossFxToEur),
          grossAmountEurFrozen: String(grossEurFrozen),
          feesEur: String(fees),
          cpaEur: String(cpa),
          shippingCostEur: String(shipping),
          packagingCostEur: String(packaging),
          returnCostEur: String(returns),
          status: status || "pending",
          paymentStatus: paymentStatus || "unpaid",
          orderedAt: parsedOrderDate,
          cogsEur: "0",
          netProfitEur: "0",
        },
      });

      let totalCogs = 0;
      let totalRevenue = 0;

      for (const rawItem of items) {
        const quantity = Number(rawItem.quantity || 1);
        const unitOriginal = numberOrZero(rawItem.unitPriceOriginal);
        const fx = numberOrZero(rawItem.fxToEur || grossFxToEur);
        const unitEur = roundMoney(unitOriginal * fx);
        const revenueEur = roundMoney(unitEur * quantity);

        let productId = rawItem.productId || null;
        let cogsLine = 0;

        if (!productId && rawItem.productEan) {
          const byScan = await findProductByScan(storeId, rawItem.productEan);
          if (byScan?.product?.id) productId = byScan.product.id;
        }

        if (productId) {
          const productExists = await tx.product.findFirst({
            where: { id: productId, storeId },
            select: { id: true },
          });
          if (!productExists) throw new Error("INVALID_PRODUCT_FOR_STORE");
        }

        if (productId) {
          const availableLots = await tx.inventoryLot.findMany({
            where: { storeId, productId, quantityAvailable: { gt: 0 }, status: "available" },
            orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
          });

          let remaining = quantity;
          for (const lot of availableLots) {
            if (remaining <= 0) break;
            const avail = Number(lot.quantityAvailable);
            if (avail <= 0) continue;
            const used = Math.min(avail, remaining);
            remaining -= used;

            await tx.inventoryLot.update({
              where: { id: lot.id },
              data: { quantityAvailable: avail - used },
            });

            await tx.inventoryMovement.create({
              data: {
                storeId,
                productId,
                lotId: lot.id,
                warehouseId: lot.warehouseId,
                movementType: "sale_out",
                quantity: -used,
                unitCostEurFrozen: lot.unitCostEurFrozen,
                referenceType: "sales_order",
                referenceId: createdOrder.id,
                reason: `Order ${createdOrder.orderNumber}`,
                createdByUserId: userId,
              },
            });

            cogsLine += roundMoney(numberOrZero(lot.unitCostEurFrozen) * used);
          }

          if (remaining > 0) {
            throw new Error("INSUFFICIENT_STOCK_FOR_ORDER_ITEM");
          }
        }

        totalRevenue += revenueEur;
        totalCogs += cogsLine;

        await tx.salesOrderItem.create({
          data: {
            storeId,
            orderId: createdOrder.id,
            productId,
            productEan: rawItem.productEan || null,
            title: rawItem.title || null,
            quantity,
            unitPriceOriginal: String(unitOriginal),
            fxToEur: String(fx),
            unitPriceEurFrozen: String(unitEur),
            revenueEurFrozen: String(revenueEur),
            cogsEurFrozen: String(cogsLine),
          },
        });
      }

      const netProfit = roundMoney(grossEurFrozen - fees - cpa - shipping - packaging - returns - totalCogs);
      const revenueDiff = Math.abs(roundMoney(totalRevenue - grossEurFrozen));
      if (revenueDiff > 0.05) {
        throw new Error("ORDER_REVENUE_MISMATCH");
      }

      return tx.salesOrder.update({
        where: { id: createdOrder.id },
        data: {
          cogsEur: String(totalCogs),
          netProfitEur: String(netProfit),
        },
        include: {
          items: true,
          sourceChannel: { select: { id: true, code: true, name: true } },
          customer: { select: { id: true, fullName: true, email: true, country: true } },
        },
      });
    });

    return res.status(201).json({ order });
  } catch (err) {
    if (String(err?.message || "") === "INVALID_PRODUCT_FOR_STORE") {
      return res.status(400).json({ error: "Order item references product outside current store" });
    }
    if (String(err?.message || "") === "INSUFFICIENT_STOCK_FOR_ORDER_ITEM") {
      return res.status(409).json({ error: "Insufficient stock for one or more order items" });
    }
    if (String(err?.message || "") === "ORDER_REVENUE_MISMATCH") {
      return res.status(400).json({ error: "Order gross amount does not match sum of item revenues" });
    }
    if (err?.code === "P2002") return res.status(409).json({ error: "Order number already exists" });
    console.error("POST /orders error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.patch("/orders/:orderId/status", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { orderId } = req.params;
    const { storeId, status, paymentStatus } = req.body || {};

    if (!storeId || (!status && !paymentStatus)) {
      return res.status(400).json({ error: "Missing storeId or status updates" });
    }
    if (status && !ORDER_STATUSES.has(String(status))) {
      return res.status(400).json({ error: "Invalid order status" });
    }
    if (paymentStatus && !PAYMENT_STATUSES.has(String(paymentStatus))) {
      return res.status(400).json({ error: "Invalid payment status" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canWrite = await canManageOrders(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage orders" });

    const order = await prisma.salesOrder.findFirst({
      where: { id: orderId, storeId },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (status && status !== order.status) {
      const allowedNext = ORDER_STATUS_FLOW[String(order.status)] || new Set();
      if (!allowedNext.has(String(status))) {
        return res.status(409).json({
          error: "Invalid order status transition",
          from: order.status,
          to: status,
        });
      }
    }

    if (paymentStatus && paymentStatus !== order.paymentStatus) {
      const allowedNext = PAYMENT_STATUS_FLOW[String(order.paymentStatus)] || new Set();
      if (!allowedNext.has(String(paymentStatus))) {
        return res.status(409).json({
          error: "Invalid payment status transition",
          from: order.paymentStatus,
          to: paymentStatus,
        });
      }
    }

    const updated = await prisma.salesOrder.update({
      where: { id: orderId },
      data: {
        ...(status ? { status } : {}),
        ...(paymentStatus ? { paymentStatus } : {}),
      },
    });

    return res.json({ order: updated });
  } catch (err) {
    console.error("PATCH /orders/:orderId/status error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/payouts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const storeId = String(req.query.storeId || "").trim();
    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canSensitive = await canReadSensitive(userId, storeId, membership.roleKey);
    if (!canSensitive) return res.status(403).json({ error: "No permission to read payouts" });

    const payouts = await prisma.payout.findMany({
      where: { storeId },
      include: {
        channel: { select: { id: true, code: true, name: true } },
        matches: {
          include: {
            order: { select: { id: true, orderNumber: true, grossAmountEurFrozen: true, netProfitEur: true } },
          },
        },
      },
      orderBy: { payoutDate: "desc" },
      take: 200,
    });

    return res.json({
      payouts: payouts.map((p) => ({
        ...(() => {
          const gross = normalizeMoney(p.amountEurFrozen);
          const fees = normalizeMoney(p.feesEur);
          const adjustments = normalizeMoney(p.adjustmentsEur);
          const reconciled = roundMoney(p.matches.reduce((sum, m) => sum + numberOrZero(m.amountEur), 0));
          const netExpected = roundMoney(numberOrZero(gross) - numberOrZero(fees) + numberOrZero(adjustments));
          return {
            netExpectedEur: netExpected,
            reconciledEur: reconciled,
            discrepancyEur: roundMoney(netExpected - reconciled),
          };
        })(),
        ...p,
        amountOriginal: normalizeMoney(p.amountOriginal),
        fxToEur: normalizeMoney(p.fxToEur),
        amountEurFrozen: normalizeMoney(p.amountEurFrozen),
        feesEur: normalizeMoney(p.feesEur),
        adjustmentsEur: normalizeMoney(p.adjustmentsEur),
      })),
    });
  } catch (err) {
    console.error("GET /payouts error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/payouts", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      storeId,
      channelId,
      payoutRef,
      payoutDate,
      currencyCode,
      amountOriginal,
      fxToEur,
      feesEur,
      adjustmentsEur,
      note,
      orderMatches,
    } = req.body || {};

    if (!storeId || !payoutRef || !payoutDate || !currencyCode || !amountOriginal || !fxToEur) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!isPositiveNumber(amountOriginal) || !isPositiveNumber(fxToEur)) {
      return res.status(400).json({ error: "amountOriginal and fxToEur must be positive numbers" });
    }
    if (![feesEur, adjustmentsEur].every((v) => v === undefined || Number.isFinite(Number(v)))) {
      return res.status(400).json({ error: "feesEur and adjustmentsEur must be numeric values" });
    }
    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canWrite = await canManagePayouts(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage payouts" });

    if (channelId) {
      const channel = await prisma.salesChannel.findFirst({
        where: { id: channelId, storeId },
        select: { id: true },
      });
      if (!channel) return res.status(400).json({ error: "Invalid channelId for this store" });
    }
    const parsedPayoutDate = parseDateInput(payoutDate);
    if (!parsedPayoutDate) return res.status(400).json({ error: "Invalid payoutDate" });
    const parsedCurrency = parseCurrencyCode(currencyCode);
    if (!parsedCurrency) return res.status(400).json({ error: "Invalid currencyCode format (expected ISO-4217 like EUR)" });

    const amountEurFrozen = roundMoney(numberOrZero(amountOriginal) * numberOrZero(fxToEur));
    const feesValue = numberOrZero(feesEur);
    const adjustmentsValue = numberOrZero(adjustmentsEur);
    const netPayoutEur = roundMoney(amountEurFrozen - feesValue + adjustmentsValue);
    if (netPayoutEur < 0) {
      return res.status(400).json({ error: "Net payout cannot be negative after fees/adjustments" });
    }
    const payout = await prisma.$transaction(async (tx) => {
      let matchedTotal = 0;
      const matchIds = new Set();
      const created = await tx.payout.create({
        data: {
          storeId,
          channelId: channelId || null,
          payoutRef: String(payoutRef).trim(),
          payoutDate: parsedPayoutDate,
          currencyCode: parsedCurrency,
          amountOriginal: String(amountOriginal),
          fxToEur: String(fxToEur),
          amountEurFrozen: String(amountEurFrozen),
          feesEur: String(feesValue),
          adjustmentsEur: String(adjustmentsValue),
          note: note || null,
        },
      });

      if (Array.isArray(orderMatches)) {
        for (const m of orderMatches) {
          if (!m?.orderId || !m?.amountEur) continue;
          if (!isPositiveNumber(m.amountEur)) throw new Error("INVALID_MATCH_AMOUNT");
          if (matchIds.has(m.orderId)) throw new Error("DUPLICATE_ORDER_MATCH");
          matchIds.add(m.orderId);
          const order = await tx.salesOrder.findFirst({
            where: { id: m.orderId, storeId },
            select: { id: true, sourceChannelId: true },
          });
          if (!order) throw new Error("INVALID_ORDER_MATCH");
          if (channelId && order.sourceChannelId && order.sourceChannelId !== channelId) {
            throw new Error("ORDER_CHANNEL_MISMATCH");
          }
          matchedTotal += numberOrZero(m.amountEur);
          await tx.payoutOrderMatch.create({
            data: {
              storeId,
              payoutId: created.id,
              orderId: m.orderId,
              amountEur: String(numberOrZero(m.amountEur)),
            },
          });
        }
      }

      if (roundMoney(matchedTotal) > roundMoney(netPayoutEur) + 0.01) {
        throw new Error("MATCHES_EXCEED_PAYOUT");
      }

      return tx.payout.findUnique({
        where: { id: created.id },
        include: {
          matches: {
            include: { order: { select: { id: true, orderNumber: true, grossAmountEurFrozen: true } } },
          },
          channel: { select: { id: true, code: true, name: true } },
        },
      });
    });

    return res.status(201).json({ payout });
  } catch (err) {
    const message = String(err?.message || "");
    if (message === "INVALID_MATCH_AMOUNT") return res.status(400).json({ error: "Each order match amount must be positive" });
    if (message === "DUPLICATE_ORDER_MATCH") return res.status(400).json({ error: "Duplicate order in payout matches" });
    if (message === "INVALID_ORDER_MATCH") return res.status(400).json({ error: "One or more matched orders are invalid for this store" });
    if (message === "ORDER_CHANNEL_MISMATCH") return res.status(400).json({ error: "Matched order channel does not match payout channel" });
    if (message === "MATCHES_EXCEED_PAYOUT") return res.status(409).json({ error: "Matched total exceeds payout amount" });
    if (err?.code === "P2002") return res.status(409).json({ error: "Payout reference already exists" });
    console.error("POST /payouts error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/payouts/:payoutId/match", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { payoutId } = req.params;
    const { storeId, orderId, amountEur } = req.body || {};
    if (!storeId || !orderId || !amountEur) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!isPositiveNumber(amountEur)) {
      return res.status(400).json({ error: "amountEur must be a positive number" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canWrite = await canManagePayouts(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage payouts" });

    const [payout, order, existingMatchTotal] = await Promise.all([
      prisma.payout.findFirst({
        where: { id: payoutId, storeId },
        select: { id: true, amountEurFrozen: true, feesEur: true, adjustmentsEur: true, channelId: true },
      }),
      prisma.salesOrder.findFirst({
        where: { id: orderId, storeId },
        select: { id: true, sourceChannelId: true },
      }),
      prisma.payoutOrderMatch.aggregate({
        where: { payoutId, storeId, NOT: { orderId } },
        _sum: { amountEur: true },
      }),
    ]);
    if (!payout || !order) return res.status(404).json({ error: "Payout or order not found" });
    if (payout.channelId && order.sourceChannelId && payout.channelId !== order.sourceChannelId) {
      return res.status(400).json({ error: "Order channel does not match payout channel" });
    }

    const used = numberOrZero(existingMatchTotal?._sum?.amountEur);
    const candidate = used + numberOrZero(amountEur);
    const netAvailable = roundMoney(
      numberOrZero(payout.amountEurFrozen) - numberOrZero(payout.feesEur) + numberOrZero(payout.adjustmentsEur)
    );
    if (roundMoney(candidate) > netAvailable + 0.01) {
      return res.status(409).json({ error: "Match exceeds available payout amount" });
    }

    const match = await prisma.payoutOrderMatch.upsert({
      where: { payoutId_orderId: { payoutId, orderId } },
      update: { amountEur: String(numberOrZero(amountEur)) },
      create: { storeId, payoutId, orderId, amountEur: String(numberOrZero(amountEur)) },
    });

    return res.json({ match });
  } catch (err) {
    console.error("POST /payouts/:payoutId/match error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/invoices", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const storeId = String(req.query.storeId || "").trim();
    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canSensitive = await canReadSensitive(userId, storeId, membership.roleKey);
    if (!canSensitive) return res.status(403).json({ error: "No permission to read invoices" });

    const invoices = await prisma.invoice.findMany({
      where: { storeId },
      include: { order: { select: { id: true, orderNumber: true, customerCountryCode: true } } },
      orderBy: { issuedAt: "desc" },
      take: 200,
    });

    return res.json({
      invoices: invoices.map((i) => ({
        ...i,
        subtotalEur: normalizeMoney(i.subtotalEur),
        taxEur: normalizeMoney(i.taxEur),
        totalEur: normalizeMoney(i.totalEur),
      })),
    });
  } catch (err) {
    console.error("GET /invoices error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

  app.post("/invoices", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { storeId, orderId, dueAt, billingName, billingAddress, billingCountry, notes, taxEur } = req.body || {};
    if (!storeId || !orderId) return res.status(400).json({ error: "Missing storeId or orderId" });
    if (taxEur !== undefined && !isNonNegativeNumber(taxEur)) {
      return res.status(400).json({ error: "taxEur must be a non-negative number" });
    }

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canWrite = await canManageInvoices(userId, storeId, membership.roleKey);
    if (!canWrite) return res.status(403).json({ error: "No permission to manage invoices" });

    const parsedDueAt = dueAt ? parseDateInput(dueAt) : null;
    if (dueAt && !parsedDueAt) {
      return res.status(400).json({ error: "Invalid dueAt date" });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id: orderId, storeId },
        select: { id: true, currencyCode: true, grossAmountEurFrozen: true, status: true, paymentStatus: true },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.status === "cancelled") throw new Error("ORDER_CANCELLED");
      if (order.paymentStatus === "unpaid") throw new Error("ORDER_UNPAID");

      const existing = await tx.invoice.findUnique({ where: { orderId }, select: { id: true } });
      if (existing) {
        return tx.invoice.findUnique({ where: { id: existing.id }, include: { order: true } });
      }

      const subtotal = numberOrZero(order.grossAmountEurFrozen);
      const tax = numberOrZero(taxEur);
      const total = roundMoney(subtotal + tax);
      const invoiceNumber = await nextInvoiceNumber(tx, storeId);

      return tx.invoice.create({
        data: {
          storeId,
          orderId,
          invoiceNumber,
          status: "issued",
          issuedAt: new Date(),
          dueAt: parsedDueAt,
          currencyCode: order.currencyCode || "EUR",
          subtotalEur: String(subtotal),
          taxEur: String(tax),
          totalEur: String(total),
          billingName: billingName || null,
          billingAddress: billingAddress || null,
          billingCountry: billingCountry || null,
          notes: notes || null,
        },
        include: { order: true },
      });
    });

    return res.status(201).json({ invoice });
  } catch (err) {
    if (String(err?.message || "") === "ORDER_NOT_FOUND") {
      return res.status(404).json({ error: "Order not found" });
    }
    if (String(err?.message || "") === "ORDER_CANCELLED") {
      return res.status(409).json({ error: "Cannot invoice a cancelled order" });
    }
    if (String(err?.message || "") === "ORDER_UNPAID") {
      return res.status(409).json({ error: "Cannot invoice an unpaid order" });
    }
    console.error("POST /invoices error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

  app.get("/invoices/:invoiceId/document", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { invoiceId } = req.params;
    const storeId = String(req.query.storeId || "").trim();
    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });
    const canSensitive = await canReadSensitive(userId, storeId, membership.roleKey);
    if (!canSensitive) return res.status(403).json({ error: "No permission to read invoice documents" });

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, storeId },
      include: { order: true, store: true },
    });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${invoice.invoiceNumber}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
      .box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-top: 12px; }
      h1 { margin: 0 0 10px 0; }
    </style>
  </head>
  <body>
    <h1>Invoice ${invoice.invoiceNumber}</h1>
    <div class="row"><span>Store</span><span>${invoice.store.name}</span></div>
    <div class="row"><span>Order</span><span>${invoice.order.orderNumber}</span></div>
    <div class="row"><span>Issued</span><span>${invoice.issuedAt.toISOString().slice(0, 10)}</span></div>
    <div class="row"><span>Billing Name</span><span>${invoice.billingName || "-"}</span></div>
    <div class="row"><span>Billing Country</span><span>${invoice.billingCountry || "-"}</span></div>
    <div class="box">
      <div class="row"><span>Subtotal (EUR)</span><span>${normalizeMoney(invoice.subtotalEur)?.toFixed(2)}</span></div>
      <div class="row"><span>Tax (EUR)</span><span>${normalizeMoney(invoice.taxEur)?.toFixed(2)}</span></div>
      <div class="row"><strong>Total (EUR)</strong><strong>${normalizeMoney(invoice.totalEur)?.toFixed(2)}</strong></div>
    </div>
  </body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error("GET /invoices/:invoiceId/document error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/products/:productId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { productId } = req.params;
    const storeId = String(req.query.storeId || "").trim();

    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    const membership = await getStoreMembership(userId, storeId);
    if (!membership) return res.status(403).json({ error: "No access to store" });

    const sensitive = await canReadSensitive(userId, storeId, membership.roleKey);

    const product = await prisma.product.findFirst({
      where: { id: productId, storeId },
      include: {
        eanAliases: true,
        listings: { include: { channel: true } },
        texts: true,
        lots: {
          include: {
            warehouse: { select: { id: true, code: true, name: true } },
            location: { select: { id: true, code: true, name: true } },
          },
          orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
        },
        movements: {
          take: 100,
          orderBy: { createdAt: "desc" },
          include: {
            warehouse: { select: { id: true, code: true, name: true } },
            createdBy: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });

    if (!product) return res.status(404).json({ error: "Product not found" });

    const lots = product.lots.map((lot) => {
      if (!sensitive) {
        return {
          id: lot.id,
          lotCode: lot.lotCode,
          sourceType: lot.sourceType,
          status: lot.status,
          supplierName: null,
          purchasedAt: lot.purchasedAt,
          receivedAt: lot.receivedAt,
          quantityReceived: lot.quantityReceived,
          quantityAvailable: lot.quantityAvailable,
          warehouse: lot.warehouse,
          location: lot.location,
          note: lot.note,
        };
      }

      return {
        ...lot,
        unitCostOriginal: normalizeMoney(lot.unitCostOriginal),
        fxToEur: normalizeMoney(lot.fxToEur),
        unitCostEurFrozen: normalizeMoney(lot.unitCostEurFrozen),
      };
    });

    return res.json({
      product: {
        ...product,
        lots,
      },
      access: { roleKey: membership.roleKey, canReadSensitive: sensitive },
    });
  } catch (err) {
    console.error("GET /products/:productId error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
