const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function upsertPermission(key, description) {
  return prisma.permission.upsert({
    where: { key },
    update: { description },
    create: { key, description },
  });
}

async function main() {
  const holding = await prisma.holdingCompany.upsert({
    where: { name: "TAWA Co" },
    update: {},
    create: { name: "TAWA Co" },
  });

  const store = await prisma.store.upsert({
    where: { holdingId_code: { holdingId: holding.id, code: "DEMARCA" } },
    update: {
      name: "DEMARCA",
      status: "active",
      description: "Store DEMARCA",
      baseCurrencyCode: "EUR",
      invoicePrefix: "DEM-2026",
    },
    create: {
      holdingId: holding.id,
      code: "DEMARCA",
      name: "DEMARCA",
      status: "active",
      description: "Store DEMARCA",
      baseCurrencyCode: "EUR",
      invoicePrefix: "DEM-2026",
    },
  });

  const currencies = [
    { code: "EUR", name: "Euro", symbol: "EUR" },
    { code: "USD", name: "US Dollar", symbol: "USD" },
    { code: "CNY", name: "Chinese Yuan", symbol: "CNY" },
    { code: "PEN", name: "Peruvian Sol", symbol: "PEN" },
    { code: "TRY", name: "Turkish Lira", symbol: "TRY" },
  ];

  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, symbol: c.symbol },
      create: c,
    });

    await prisma.storeCurrency.upsert({
      where: { storeId_currencyCode: { storeId: store.id, currencyCode: c.code } },
      update: { enabled: true },
      create: { storeId: store.id, currencyCode: c.code, enabled: true },
    });
  }

  await prisma.fxRate.upsert({
    where: {
      storeId_baseCurrencyCode_quoteCurrencyCode_rateDate: {
        storeId: store.id,
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "EUR",
        rateDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
    update: { rate: "0.92000000", source: "seed" },
    create: {
      storeId: store.id,
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "EUR",
      rate: "0.92000000",
      rateDate: new Date("2026-01-01T00:00:00.000Z"),
      source: "seed",
    },
  });

  const warehouseES = await prisma.warehouse.upsert({
    where: { storeId_code: { storeId: store.id, code: "ES-MAD" } },
    update: {
      name: "Madrid Warehouse",
      country: "ES",
      status: "active",
      type: "own",
      isDefault: true,
    },
    create: {
      storeId: store.id,
      code: "ES-MAD",
      name: "Madrid Warehouse",
      country: "ES",
      status: "active",
      type: "own",
      isDefault: true,
    },
  });

  const warehouseIT = await prisma.warehouse.upsert({
    where: { storeId_code: { storeId: store.id, code: "IT-MIL" } },
    update: {
      name: "Milan Warehouse",
      country: "IT",
      status: "active",
      type: "external",
      isDefault: false,
    },
    create: {
      storeId: store.id,
      code: "IT-MIL",
      name: "Milan Warehouse",
      country: "IT",
      status: "active",
      type: "external",
      isDefault: false,
    },
  });

  const locationA1 = await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouseES.id, code: "A1" } },
    update: { name: "Estanteria A1", isActive: true },
    create: { warehouseId: warehouseES.id, code: "A1", name: "Estanteria A1", isActive: true },
  });

  await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouseIT.id, code: "R1" } },
    update: { name: "Rack R1", isActive: true },
    create: { warehouseId: warehouseIT.id, code: "R1", name: "Rack R1", isActive: true },
  });

  const channelShopify = await prisma.salesChannel.upsert({
    where: { storeId_code: { storeId: store.id, code: "SHOPIFY-ES" } },
    update: { name: "Shopify ES", type: "shopify", status: "active", feePercent: "2.9000" },
    create: {
      storeId: store.id,
      code: "SHOPIFY-ES",
      name: "Shopify ES",
      type: "shopify",
      status: "active",
      feePercent: "2.9000",
      payoutTerms: "15 days post-delivery",
    },
  });

  const channelIdealoDE = await prisma.salesChannel.upsert({
    where: { storeId_code: { storeId: store.id, code: "IDEALO-DE" } },
    update: { name: "Idealo DE", type: "idealo", status: "active", feePercent: "7.5000" },
    create: {
      storeId: store.id,
      code: "IDEALO-DE",
      name: "Idealo DE",
      type: "idealo",
      status: "active",
      feePercent: "7.5000",
      payoutTerms: "20 business days",
    },
  });

  const passwordHash = await bcrypt.hash("Admin123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@demarca.local" },
    update: {
      passwordHash,
      fullName: "Admin DEMARCA",
      preferredLocale: "es",
      isActive: true,
    },
    create: {
      email: "admin@demarca.local",
      passwordHash,
      fullName: "Admin DEMARCA",
      preferredLocale: "es",
      isActive: true,
    },
  });

  await prisma.userStoreMembership.upsert({
    where: { userId_storeId: { userId: admin.id, storeId: store.id } },
    update: { roleKey: "admin" },
    create: { userId: admin.id, storeId: store.id, roleKey: "admin" },
  });

  const warehouseUser = await prisma.user.upsert({
    where: { email: "warehouse@demarca.local" },
    update: {
      passwordHash,
      fullName: "Warehouse DEMARCA",
      preferredLocale: "es",
      isActive: true,
    },
    create: {
      email: "warehouse@demarca.local",
      passwordHash,
      fullName: "Warehouse DEMARCA",
      preferredLocale: "es",
      isActive: true,
    },
  });

  await prisma.userStoreMembership.upsert({
    where: { userId_storeId: { userId: warehouseUser.id, storeId: store.id } },
    update: { roleKey: "warehouse" },
    create: { userId: warehouseUser.id, storeId: store.id, roleKey: "warehouse" },
  });

  const perms = [
    ["inventory.read", "Read inventory"],
    ["inventory.write", "Move stock"],
    ["finance.read", "Read financial data"],
    ["suppliers.read", "Read supplier data"],
    ["products.write", "Create/update products"],
    ["orders.write", "Create/update orders"],
    ["payouts.write", "Create payouts and reconciliation"],
    ["invoices.write", "Create invoices"],
  ];

  const permissionByKey = {};
  for (const [key, description] of perms) {
    const p = await upsertPermission(key, description);
    permissionByKey[key] = p;
  }

  await prisma.userPermission.upsert({
    where: {
      userId_storeId_permissionId: {
        userId: admin.id,
        storeId: store.id,
        permissionId: permissionByKey["finance.read"].id,
      },
    },
    update: { granted: true },
    create: {
      userId: admin.id,
      storeId: store.id,
      permissionId: permissionByKey["finance.read"].id,
      granted: true,
    },
  });

  const product = await prisma.product.upsert({
    where: { storeId_ean: { storeId: store.id, ean: "8435601200001" } },
    update: {
      type: "watch",
      brand: "Armani",
      model: "AR2434",
      name: "Armani AR2434",
      status: "active",
      isInternalEan: false,
    },
    create: {
      storeId: store.id,
      ean: "8435601200001",
      sku: "ARM-AR2434",
      type: "watch",
      brand: "Armani",
      model: "AR2434",
      name: "Armani AR2434",
      status: "active",
      isInternalEan: false,
      internalDescription: "Reloj para canal premium",
    },
  });

  await prisma.eanAlias.upsert({
    where: { storeId_ean: { storeId: store.id, ean: "INT-DEM-000001" } },
    update: { productId: product.id, source: "manual" },
    create: {
      storeId: store.id,
      productId: product.id,
      ean: "INT-DEM-000001",
      source: "manual",
      note: "Internal scanning alias",
    },
  });

  await prisma.productChannel.upsert({
    where: { productId_channelId: { productId: product.id, channelId: channelShopify.id } },
    update: {
      listingStatus: "active",
      publicName: "Armani AR2434 - Shopify",
      listingUrl: "https://shopify.example/products/ar2434",
      priceOriginal: "199.00",
      priceCurrencyCode: "EUR",
      priceFxToEur: "1.000000",
      priceEurFrozen: "199.00",
    },
    create: {
      productId: product.id,
      channelId: channelShopify.id,
      listingStatus: "active",
      publicName: "Armani AR2434 - Shopify",
      listingUrl: "https://shopify.example/products/ar2434",
      priceOriginal: "199.00",
      priceCurrencyCode: "EUR",
      priceFxToEur: "1.000000",
      priceEurFrozen: "199.00",
    },
  });

  await prisma.productChannel.upsert({
    where: { productId_channelId: { productId: product.id, channelId: channelIdealoDE.id } },
    update: {
      listingStatus: "active",
      publicName: "Armani AR2434 - Idealo DE",
      listingUrl: "https://idealo.example/de/ar2434",
      priceOriginal: "209.00",
      priceCurrencyCode: "EUR",
      priceFxToEur: "1.000000",
      priceEurFrozen: "209.00",
    },
    create: {
      productId: product.id,
      channelId: channelIdealoDE.id,
      listingStatus: "active",
      publicName: "Armani AR2434 - Idealo DE",
      listingUrl: "https://idealo.example/de/ar2434",
      priceOriginal: "209.00",
      priceCurrencyCode: "EUR",
      priceFxToEur: "1.000000",
      priceEurFrozen: "209.00",
    },
  });

  await prisma.productText.upsert({
    where: {
      productId_locale_channelId: {
        productId: product.id,
        locale: "es",
        channelId: null,
      },
    },
    update: {
      publicName: "Reloj Armani AR2434",
      description: "Descripcion interna base en espanol",
    },
    create: {
      storeId: store.id,
      productId: product.id,
      locale: "es",
      channelId: null,
      publicName: "Reloj Armani AR2434",
      description: "Descripcion interna base en espanol",
    },
  });

  const lot = await prisma.inventoryLot.upsert({
    where: { id: "seed-lot-armani-es-001" },
    update: {
      quantityReceived: 10,
      quantityAvailable: 10,
      unitCostOriginal: "120.0000",
      costCurrencyCode: "USD",
      fxToEur: "0.920000",
      unitCostEurFrozen: "110.4000",
      status: "available",
    },
    create: {
      id: "seed-lot-armani-es-001",
      storeId: store.id,
      productId: product.id,
      warehouseId: warehouseES.id,
      locationId: locationA1.id,
      lotCode: "LOT-2026-ES-0001",
      sourceType: "manual_init",
      status: "available",
      supplierName: "Supplier Demo",
      purchasedAt: new Date("2026-01-10T00:00:00.000Z"),
      receivedAt: new Date("2026-01-18T00:00:00.000Z"),
      quantityReceived: 10,
      quantityAvailable: 10,
      unitCostOriginal: "120.0000",
      costCurrencyCode: "USD",
      fxToEur: "0.920000",
      unitCostEurFrozen: "110.4000",
      note: "Seed initial lot",
    },
  });

  await prisma.inventoryMovement.create({
    data: {
      storeId: store.id,
      productId: product.id,
      lotId: lot.id,
      warehouseId: warehouseES.id,
      movementType: "lot_create",
      quantity: 10,
      unitCostEurFrozen: "110.4000",
      referenceType: "seed",
      referenceId: "seed-lot-armani-es-001",
      reason: "Initial inventory seed",
      createdByUserId: admin.id,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { id: "seed-customer-de-001" },
    update: {
      storeId: store.id,
      email: "cliente.demo@example.com",
      fullName: "Cliente Demo DE",
      country: "DE",
      city: "Berlin",
    },
    create: {
      id: "seed-customer-de-001",
      storeId: store.id,
      email: "cliente.demo@example.com",
      fullName: "Cliente Demo DE",
      country: "DE",
      city: "Berlin",
    },
  });

  const order = await prisma.salesOrder.upsert({
    where: { storeId_orderNumber: { storeId: store.id, orderNumber: "SO-1168" } },
    update: {
      platform: "Shopify",
      sourceChannelId: channelIdealoDE.id,
      sourceLabel: "Idealo DE",
      customerId: customer.id,
      customerCountryCode: "DE",
      currencyCode: "EUR",
      grossAmountOriginal: "209.00",
      grossFxToEur: "1.000000",
      grossAmountEurFrozen: "209.00",
      feesEur: "8.50",
      cpaEur: "4.20",
      shippingCostEur: "5.90",
      packagingCostEur: "1.20",
      returnCostEur: "0.00",
      cogsEur: "110.40",
      netProfitEur: "78.80",
      status: "delivered",
      paymentStatus: "paid",
      orderedAt: new Date("2026-02-15T12:00:00.000Z"),
    },
    create: {
      storeId: store.id,
      orderNumber: "SO-1168",
      platform: "Shopify",
      sourceChannelId: channelIdealoDE.id,
      sourceLabel: "Idealo DE",
      customerId: customer.id,
      customerCountryCode: "DE",
      currencyCode: "EUR",
      grossAmountOriginal: "209.00",
      grossFxToEur: "1.000000",
      grossAmountEurFrozen: "209.00",
      feesEur: "8.50",
      cpaEur: "4.20",
      shippingCostEur: "5.90",
      packagingCostEur: "1.20",
      returnCostEur: "0.00",
      cogsEur: "110.40",
      netProfitEur: "78.80",
      status: "delivered",
      paymentStatus: "paid",
      orderedAt: new Date("2026-02-15T12:00:00.000Z"),
    },
  });

  await prisma.salesOrderItem.upsert({
    where: { id: "seed-order-item-1168-1" },
    update: {
      storeId: store.id,
      orderId: order.id,
      productId: product.id,
      productEan: product.ean,
      title: "Armani AR2434",
      quantity: 1,
      unitPriceOriginal: "209.00",
      fxToEur: "1.000000",
      unitPriceEurFrozen: "209.00",
      revenueEurFrozen: "209.00",
      cogsEurFrozen: "110.40",
    },
    create: {
      id: "seed-order-item-1168-1",
      storeId: store.id,
      orderId: order.id,
      productId: product.id,
      productEan: product.ean,
      title: "Armani AR2434",
      quantity: 1,
      unitPriceOriginal: "209.00",
      fxToEur: "1.000000",
      unitPriceEurFrozen: "209.00",
      revenueEurFrozen: "209.00",
      cogsEurFrozen: "110.40",
    },
  });

  const payout = await prisma.payout.upsert({
    where: { storeId_payoutRef: { storeId: store.id, payoutRef: "PAY-2026-02-IDEALO-01" } },
    update: {
      channelId: channelIdealoDE.id,
      payoutDate: new Date("2026-03-01T00:00:00.000Z"),
      currencyCode: "EUR",
      amountOriginal: "198.00",
      fxToEur: "1.000000",
      amountEurFrozen: "198.00",
      feesEur: "8.50",
      adjustmentsEur: "-2.50",
      note: "Payout monthly Idealo DE",
    },
    create: {
      storeId: store.id,
      channelId: channelIdealoDE.id,
      payoutRef: "PAY-2026-02-IDEALO-01",
      payoutDate: new Date("2026-03-01T00:00:00.000Z"),
      currencyCode: "EUR",
      amountOriginal: "198.00",
      fxToEur: "1.000000",
      amountEurFrozen: "198.00",
      feesEur: "8.50",
      adjustmentsEur: "-2.50",
      note: "Payout monthly Idealo DE",
    },
  });

  await prisma.payoutOrderMatch.upsert({
    where: { payoutId_orderId: { payoutId: payout.id, orderId: order.id } },
    update: { storeId: store.id, amountEur: "198.00" },
    create: {
      storeId: store.id,
      payoutId: payout.id,
      orderId: order.id,
      amountEur: "198.00",
    },
  });

  await prisma.invoice.upsert({
    where: { orderId: order.id },
    update: {
      storeId: store.id,
      invoiceNumber: "DEM-2026-000001",
      status: "issued",
      issuedAt: new Date("2026-02-16T00:00:00.000Z"),
      dueAt: null,
      currencyCode: "EUR",
      subtotalEur: "209.00",
      taxEur: "0.00",
      totalEur: "209.00",
      billingName: customer.fullName,
      billingAddress: "Berlin",
      billingCountry: "DE",
      notes: "Seed invoice",
    },
    create: {
      storeId: store.id,
      orderId: order.id,
      invoiceNumber: "DEM-2026-000001",
      status: "issued",
      issuedAt: new Date("2026-02-16T00:00:00.000Z"),
      dueAt: null,
      currencyCode: "EUR",
      subtotalEur: "209.00",
      taxEur: "0.00",
      totalEur: "209.00",
      billingName: customer.fullName,
      billingAddress: "Berlin",
      billingCountry: "DE",
      notes: "Seed invoice",
    },
  });

  console.log("Seed OK");
  console.log("Holding:", holding.name);
  console.log("Store:", store.name);
  console.log("Admin:", admin.email, "password: Admin123!");
  console.log("Warehouse user:", warehouseUser.email, "password: Admin123!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
