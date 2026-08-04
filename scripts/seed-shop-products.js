const BASE_URL = process.env.MASJIDPOINT_URL || "http://127.0.0.1:4174";

const productSeeds = [
  {
    id: "PRD-SAMPLE-TASBIH",
    name: "Premium Tasbih Gift Set",
    description:
      "A refined natural-wood tasbih presented in a reusable forest-green gift box. Suitable for gifts and everyday dhikr.",
    category: "Prayer essentials",
    price: 24,
    stock: 18,
    mosqueSharePercent: 20,
    image: "assets/shop/tasbih-gift-set.png",
    mosqueIndexes: [0, 1],
  },
  {
    id: "PRD-SAMPLE-MISWAK",
    name: "Natural Miswak Care Set",
    description:
      "A neatly presented set of natural miswak sticks in an elegant protective gift box.",
    category: "Personal care",
    price: 8.5,
    stock: 35,
    mosqueSharePercent: 15,
    image: "assets/shop/miswak-care-set.png",
    mosqueIndexes: [1, 2],
  },
  {
    id: "PRD-SAMPLE-PRAYER-MAT",
    name: "Geometric Prayer Mat",
    description:
      "A premium deep-green prayer mat with warm cream geometric detailing and a soft woven finish.",
    category: "Prayer essentials",
    price: 32,
    stock: 12,
    mosqueSharePercent: 25,
    image: "assets/shop/geometric-prayer-mat.png",
    mosqueIndexes: [0, 2, 3],
  },
];

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${details}`);
  }
  return response.json();
}

async function main() {
  const state = await request("/api/state");
  const applications = Array.isArray(state.masjidPointAdminApplications)
    ? state.masjidPointAdminApplications
    : [];
  const activeMosques = applications.filter(
    (application) =>
      application.type === "masjid" &&
      ["approved", "activated"].includes(String(application.status).toLowerCase()) &&
      String(application.accountStatus || "active").toLowerCase() === "active"
  );

  if (!activeMosques.length) {
    throw new Error("No approved or activated mosque accounts were found.");
  }

  const currentProducts = Array.isArray(state.masjidPointProducts)
    ? state.masjidPointProducts
    : [];
  const productsById = new Map(currentProducts.map((product) => [product.id, product]));
  const now = new Date().toISOString();

  productSeeds.forEach((seed) => {
    const assignedMosques = [...new Set(seed.mosqueIndexes.map((index) => index % activeMosques.length))]
      .map((index) => activeMosques[index])
      .map((mosque) => ({ reference: mosque.reference, name: mosque.name }));
    const existing = productsById.get(seed.id) || {};
    productsById.set(seed.id, {
      ...existing,
      id: seed.id,
      name: seed.name,
      description: seed.description,
      category: seed.category,
      price: seed.price,
      stock: seed.stock,
      mosqueSharePercent: seed.mosqueSharePercent,
      mosques: assignedMosques,
      image: seed.image,
      visibility: "visible",
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });
  });

  const products = [...productsById.values()];
  await request("/api/collection/masjidPointProducts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(products),
  });

  productSeeds.forEach((seed) => {
    const product = productsById.get(seed.id);
    console.log(`${product.name}: ${product.mosques.map((mosque) => mosque.name).join(", ")}`);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
