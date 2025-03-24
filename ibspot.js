const puppeteer = require("puppeteer");
const fs = require("fs");
const fsPromises = require("fs").promises;
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});
const axios = require("axios");

// Utility function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Prompt user for USD exchange rate
const getExchangeRate = () =>
  new Promise((resolve) => {
    readline.question(
      "Enter the current USD exchange rate (e.g., 32.50): ",
      (rate) => {
        const exchangeRate = parseFloat(rate.trim()) || 1.0;
        console.log(`Using exchange rate: ${exchangeRate}`);
        resolve(exchangeRate);
      }
    );
  });

// Prompt user for category
const getCategory = () =>
  new Promise((resolve) => {
    readline.question(
      "Enter the category to search in taxons: ",
      (category) => {
        const trimmedCategory = category.trim();
        console.log(`Using category: ${trimmedCategory || "Default Category"}`);
        resolve(trimmedCategory || "Saç Fırçası ve Tarak");
      }
    );
  });

// Generate a unique test product with prices in local currency
const generateTestProduct = (index, exchangeRate) => {
  const randomId = Math.floor(Math.random() * 10000);
  const categories = `BEYZANA>Kozmetik>Saç Bakımı>Saç Fırçası ve Tarak>BEYZANA Saç Fırçası ve Tarak ${index}>Tavşan Desenli Kız Çoçuğu Tarağı ${randomId}`;
  const usdPrice = (Math.random() * 100 + 50).toFixed(2);
  return {
    title: `Test Product ${index} - Tavşan Desenli Tarak ${randomId}`,
    productId: `TEST${randomId}`,
    usdPrice: usdPrice, // Store original USD price
    price: (usdPrice * exchangeRate).toFixed(2), // Convert to local currency
    brand: "BEYZANA",
    sourceUrl: `https://example.com/test-product-${index}`,
    description: `<p>Test product description for Tavşan Desenli Tarak ${index}</p>`,
    images: `https://example.com/test-image-${index}.jpg`,
    categories,
    specifications: [
      { name: "Material", value: `Wood${index}` },
      { name: "Size", value: `Medium${index}` },
    ],
  };
};

// Load or generate products with prices converted from USD
const getProducts = async (jsonPath, isTestMode, exchangeRate) => {
  try {
    const data = await fsPromises.readFile(jsonPath, "utf8");
    const products = JSON.parse(data);
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error("Invalid or empty JSON file");
    }

    return products.map((p, i) => {
      console.log({ price: p.price });

      const baseUsdPrice = p.price / exchangeRate; // Price assumed in USD
      const basePrice = (baseUsdPrice * exchangeRate).toFixed(2); // Convert to local currency
      const masterPrice = (basePrice * 1.1).toFixed(2); // 10% markup in local currency
      const price = (parseFloat(masterPrice) + Math.random() * 15 + 5).toFixed(
        2
      ); // Final price with random addition
      const testProduct = isTestMode
        ? generateTestProduct(i, exchangeRate)
        : {};

      return {
        title: String(p.title || testProduct.title || "Default Product"),
        productId: String(p.productId || testProduct.productId || "DEFAULT123"),
        usdPrice: baseUsdPrice.toFixed(2), // Store original USD price
        masterPrice: (masterPrice / exchangeRate).toFixed(2), // In local currency
        price: (price / exchangeRate).toFixed(2), // In local currency
        costPrice: (basePrice / exchangeRate).toFixed(2), // In local currency
        brand: String(p.brand || testProduct.brand || "DefaultBrand"),
        sourceUrl: String(
          p.sourceUrl || testProduct.sourceUrl || "https://example.com"
        ),
        description: String(
          p.description ||
            testProduct.description ||
            "<p>Default description</p>"
        ),
        images: String(
          p.images || testProduct.images || "https://example.com/default.jpg"
        ),
        categories: String(
          p.categories || testProduct.categories || "General>Test"
        ),
        specifications: Array.isArray(p.specifications)
          ? p.specifications
          : testProduct.specifications || [{ name: "Default", value: "Value" }],
      };
    });
  } catch (error) {
    console.log(`Error loading JSON: ${error.message}. Using test product.`);
    return [generateTestProduct(0, exchangeRate)];
  }
};

// Prompt for JSON path or test mode
const getJsonPath = () =>
  new Promise((resolve) => {
    readline.question(
      "Enter path to products.json (or Enter for test mode): ",
      (path) => {
        const trimmedPath = path.trim().replace(/^"|"$/g, "");
        if (!trimmedPath) {
          console.log("Entering test mode.");
          const testPath = "./test_products.json";
          fsPromises.writeFile(
            testPath,
            JSON.stringify([generateTestProduct(0, 1.0)], null, 2) // Default exchange rate of 1.0 for test file
          );
          resolve({ path: testPath, isTestMode: true });
        } else {
          resolve({ path: trimmedPath, isTestMode: false });
        }
      }
    );
  });

// Navigate with retry logic
const navigateWithRetry = async (page, url, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector("body", { timeout: 5000 });
      console.log(`Navigated to: ${url}`);
      return;
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw new Error(
          `Navigation failed after ${maxRetries} attempts: ${error.message}`
        );
      }
      await delay(1000 * attempt);
    }
  }
};

// Set date in Flatpickr input
const setDate = async (page, selector, date) => {
  await page.evaluate(
    (sel, d) => {
      const input = document.querySelector(sel);
      if (input) {
        input.value = d;
        input.dispatchEvent(new Event("input"));
      }
    },
    selector,
    date
  );
};

// Select taxon in Select2 dropdown
const selectTaxon = async (page, predefinedCategory) => {
  try {
    await page.waitForSelector("#product_taxon_ids", { timeout: 5000 });
    await page.click(".select2-selection--multiple");
    await delay(500);

    console.log(`Attempting to select taxon: ${predefinedCategory}`);

    await page.evaluate(() => {
      const searchField = document.querySelector(".select2-search__field");
      searchField.value = "";
      searchField.focus();
    });
    await page.type(".select2-search__field", predefinedCategory);
    await delay(500);

    const availableTaxons = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".select2-results__option")).map(
        (opt) => opt.textContent.trim()
      )
    );
    console.log(`Available taxons: ${availableTaxons}`);

    const matchingTaxon = availableTaxons.find(
      (taxon) =>
        taxon === predefinedCategory || taxon.includes(predefinedCategory)
    );
    if (matchingTaxon) {
      await page.evaluate((taxon) => {
        const option = Array.from(
          document.querySelectorAll(".select2-results__option")
        ).find((opt) => opt.textContent.trim() === taxon);
        if (option) option.click();
      }, matchingTaxon);
    } else {
      console.log(
        `Taxon "${predefinedCategory}" not found. Pressing Enter to create/select.`
      );
      await page.keyboard.press("Enter");
    }

    await delay(300);
    const selectedTaxon = await page.evaluate(() =>
      document.querySelector(".select2-selection__choice")?.textContent.trim()
    );
    console.log(`Selected taxon: ${selectedTaxon || "None"}`);
    return true;
  } catch (error) {
    console.log(`Error selecting taxon: ${error.message}`);
    return false;
  }
};

// Optimized download media function with concurrency
const downloadMedia = async (urls, baseIndex) => {
  const downloadedFiles = [];
  const downloadPromises = urls.map(async (url, j) => {
    if (!url.startsWith("http")) {
      console.log(`Invalid URL skipped: ${url}`);
      return null;
    }

    const isVideo = url.endsWith(".mp4");
    const path = isVideo
      ? `./video_${baseIndex}_${j}.mp4`
      : `./image_${baseIndex}_${j}.jpg`;

    try {
      const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 10000,
      });
      await new Promise((resolve, reject) => {
        response.data
          .pipe(fs.createWriteStream(path))
          .on("finish", () => resolve(path))
          .on("error", reject);
      });
      downloadedFiles.push(path);
      console.log(`Downloaded ${url} to ${path}`);
      return path;
    } catch (error) {
      console.error(`Failed to download ${url}: ${error.message}`);
      return null;
    }
  });

  await Promise.all(downloadPromises);
  return downloadedFiles.filter(Boolean);
};

// Extract slug from URL
const getSlug = async (page) => {
  await delay(1000);
  const urlParts = page.url().split("/");
  const slug = urlParts[urlParts.length - 2];
  console.log(`Extracted slug: ${slug}`);
  return slug;
};

// Main product upload function
const uploadProducts = async () => {
  const config = {
    email: "buzhijiedai@gmail.com",
    password: "Godislove153",
    loginUrl: "https://ibspot.com/admin/login",
    newProductUrl: "https://ibspot.com/admin/products/new",
  };

  let browser;
  try {
    const exchangeRate = await getExchangeRate();
    const predefinedCategory = await getCategory();
    const { path, isTestMode } = await getJsonPath();
    readline.close();
    const products = await getProducts(path, isTestMode, exchangeRate);
    console.log(`Processing ${products.length} products`);

    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--start-maximized"],
      defaultViewport: null,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Login
    await navigateWithRetry(page, config.loginUrl);
    await page.type("#spree_user_email", config.email);
    await page.type("#spree_user_password", config.password);
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation(),
    ]);

    for (const [i, product] of products.entries()) {
      console.log(
        `\nProcessing ${i + 1}/${products.length}: ${product.title} (USD: ${
          product.usdPrice
        })`
      );
      const downloadedFiles = [];
      let slug;

      try {
        // Step 1: Go to new product page and enter basic details
        await navigateWithRetry(page, config.newProductUrl);
        await page.waitForSelector("#product_name", { timeout: 15000 });

        await page.evaluate(
          () => (document.querySelector("#product_name").value = "")
        );
        await page.type("#product_name", product.title);
        await page.type("#product_price", product.masterPrice); // Price in local currency
        await page.type("#product_sku", `${product.productId} sdccsdcsdcd_TR`);
        await page.select("#product_prototype_id", "1");
        await setDate(
          page,
          ".flatpickr-alt-input",
          new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0]
        );
        await page.select("#product_shipping_category_id", "5698");
        await Promise.all([
          page.click('button.btn.btn-success[type="submit"]'),
          page.waitForNavigation(),
        ]);

        // Check for SKU error
        const skuError = await page
          .$eval("#errorExplanation", (el) =>
            el?.textContent.includes("Sku has already been taken")
          )
          .catch(() => false);
        if (skuError) {
          console.log(`SKU already taken for ${product.title}. Skipping.`);
          continue;
        }

        // Get slug for subsequent steps
        slug = await getSlug(page);

        // Step 2: Go to edit page and add taxon
        try {
          const editUrl = `https://ibspot.com/admin/products/${slug}/edit`;
          await navigateWithRetry(page, editUrl);

          await page.waitForSelector("#product_compare_at_price", {
            timeout: 15000,
          });
          await page.type("#product_compare_at_price", product.price); // In local currency
          await page.type("#product_cost_price", product.costPrice); // In local currency
          await page.type("#product_main_brand", product.brand);
          await page.type("#product_source_url", product.sourceUrl);
          await page.select("#product_tax_category_id", "1");
          await selectTaxon(page, predefinedCategory);

          const frame = await (
            await page.$("#cke_product_description iframe")
          ).contentFrame();
          await frame.evaluate(
            (desc) => (document.body.innerHTML = desc),
            product.description
          );

          await page.evaluate(() => {
            const checkbox = Array.from(
              document.querySelectorAll('input[type="checkbox"]')
            ).find(
              (el) =>
                el.nextElementSibling?.textContent?.trim() === "Sync To Gmc"
            );
            if (checkbox && !checkbox.checked) checkbox.click();
          });

          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight)
          );
          await Promise.all([
            page.click('button.btn.btn-success[type="submit"]'),
            page.waitForNavigation(),
          ]);
        } catch (editError) {
          console.error(
            `Error in edit step for ${product.title}: ${editError.message}. Proceeding to next step.`
          );
        }

        // Step 3: Upload images
        try {
          const imagesUrl = `https://ibspot.com/admin/products/${slug}/images`;
          await navigateWithRetry(page, imagesUrl);

          const mediaFiles = product.images
            .split(";")
            .map((url) => url.trim())
            .filter(Boolean);

          if (!mediaFiles.length) {
            console.log(
              `No images provided for ${product.title}. Skipping image upload.`
            );
          } else {
            await page.waitForSelector(".image-placeholder .card", {
              timeout: 5000,
            });

            const downloadedPaths = await downloadMedia(mediaFiles, i);
            downloadedFiles.push(...downloadedPaths);

            for (const path of downloadedPaths) {
              await page.click(".image-placeholder .card");
              const fileInput = await page.waitForSelector(
                'input[type="file"]',
                { timeout: 3000 }
              );
              if (fileInput) {
                await fileInput.uploadFile(path);
                await page.waitForFunction(
                  () => !document.querySelector(".pending-image-template"),
                  { timeout: 15000 }
                );
                console.log(`Uploaded: ${path}`);
              } else {
                console.log(`File input not found for ${path}`);
              }
            }
          }
        } catch (imageError) {
          console.error(
            `Error in image upload step for ${product.title}: ${imageError.message}. Proceeding to next step.`
          );
        }

        // Step 4: Add product properties
        try {
          const propertiesUrl = `https://ibspot.com/admin/products/${slug}/product_properties`;
          await navigateWithRetry(page, propertiesUrl);

          await page.evaluate(() => {
            document
              .querySelectorAll('input[type="checkbox"]')
              .forEach((checkbox) => {
                if (checkbox.checked) checkbox.click();
              });
          });

          if (product.specifications && product.specifications.length > 0) {
            for (const spec of product.specifications) {
              await page.click(".spree_add_fields.btn-success");
              await delay(300);
              const row = (await page.$$("table tbody tr")).slice(-1)[0];
              await (
                await row.$("td:nth-child(2) input")
              ).type(spec.name || "");
              await (
                await row.$("td:nth-child(3) input")
              ).type(spec.value || "");
            }
          } else {
            console.log(
              `No specifications provided for ${product.title}. All properties unchecked.`
            );
          }

          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight)
          );
          await Promise.all([
            page.click('.form-actions button.btn.btn-success[type="submit"]'),
            page.waitForNavigation(),
          ]);
        } catch (propertiesError) {
          console.error(
            `Error in properties step for ${product.title}: ${propertiesError.message}. Proceeding to next step.`
          );
        }

        // Step 5: Set stock
        const stockUrl = `https://ibspot.com/admin/products/${slug}/stock`;
        await navigateWithRetry(page, stockUrl);

        await page.evaluate(() => {
          const input = document.querySelector("#stock_movement_quantity");
          if (input) input.value = "";
        });
        await page.type("#stock_movement_quantity", "100");
        await page.click(".btn.btn-primary");
        await delay(1000);

        console.log(`Successfully processed: ${product.title}`);
      } catch (error) {
        console.error(
          `Critical error processing ${product.title}: ${error.message}`
        );
      } finally {
        await Promise.all(
          downloadedFiles.map((path) =>
            fsPromises
              .unlink(path)
              .catch((err) =>
                console.error(`Error deleting ${path}: ${err.message}`)
              )
          )
        );
      }
    }
  } catch (error) {
    console.error(`Critical error: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    console.log("Browser closed");
  }
};

// Start the process
console.log("Starting product processing...");
uploadProducts();
