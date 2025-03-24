const puppeteer = require("puppeteer");
const fs = require("fs");
const fsPromises = require("fs").promises;
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});
const axios = require("axios");

// Configuration object
const CONFIG = {
  email: "buzhijiedai@gmail.com",
  password: "Godislove153",
  loginUrl: "https://ibspot.com/admin/login",
  newProductUrl: "https://ibspot.com/admin/products/new",
  productNumber: "99",
  exchangeRate: 37.06,
  jsonFilePath:
    "D:SylvanusWorksWebdavut2output\trendyolproducts_2025-03-24_https___www_trendyol_com_sr_cocuk_bebek_taragi_ve__2025-03-24_07-43-10-086.json",
  useTerminalInput: false,
};

// Utility function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Utility functions
const getConfigValues = async () => {
  return {
    exchangeRate: CONFIG.exchangeRate,
    productNumber: CONFIG.productNumber,
    jsonFilePath: CONFIG.jsonFilePath,
  };
};

const adjustPrice = (price, exchangeRate) =>
  (parseFloat(price) * exchangeRate).toFixed(2);

const getRandomNumber = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const generateRandomProduct = (exchangeRate, productNumber) => ({
  productId: `P${productNumber}-${Date.now()}`,
  title: `Sample Product ${productNumber}`,
  masterPrice: adjustPrice(10, exchangeRate),
  price: adjustPrice(15, exchangeRate),
  costPrice: adjustPrice(8, exchangeRate),
  stock: "10",
  brand: "Sample Brand",
  sourceUrl: "https://example.com",
  description: "<p>Sample product description</p>",
  keywords: ["sample", "test"],
});

const getSingleProductFromJson = async (jsonFilePath, exchangeRate) => {
  try {
    const data = await fsPromises.readFile(jsonFilePath, "utf8");
    const products = JSON.parse(data);
    const product = products[0] || {};
    return {
      productId: product.id || Date.now().toString(),
      title: product.name || "Unnamed Product",
      masterPrice: adjustPrice(product.price || 10, exchangeRate),
      price: adjustPrice(product.originalPrice || 15, exchangeRate),
      costPrice: adjustPrice(product.cost || 8, exchangeRate),
      stock: product.stock || "10",
      brand: product.brand || "Unknown Brand",
      sourceUrl: product.url || "https://example.com",
      description: product.description || "<p>No description</p>",
      keywords: product.keywords || ["product", "item"],
    };
  } catch (error) {
    console.error("Error reading JSON:", error.message);
    return generateRandomProduct(exchangeRate, CONFIG.productNumber);
  }
};

const setFlatpickrDate = async (page, selector, date) => {
  await page.evaluate(
    (sel, dateValue) => {
      const input = document.querySelector(sel);
      if (input) {
        input.value = dateValue;
        input.dispatchEvent(new Event("change"));
      }
    },
    selector,
    date
  );
};

async function selectTaxons(page, taxons) {
  try {
    await page.waitForSelector("#product_taxon_ids", {
      visible: true,
      timeout: 30000,
    });
    console.log("Taxon select field found");

    await page.evaluate(() => {
      const select = document.querySelector("#product_taxon_ids");
      if (select) {
        Array.from(select.selectedOptions).forEach(
          (option) => (option.selected = false)
        );
      }
    });

    for (const taxon of taxons) {
      console.log(`Attempting to select taxon: ${taxon}`);
      await page.click(".select2-selection--multiple");
      await delay(500);

      await page.waitForSelector(".select2-search__field", {
        visible: true,
        timeout: 5000,
      });
      await page.type(".select2-search__field", taxon, { delay: 100 });
      console.log(`Typed taxon: ${taxon}`);
      await delay(1000);

      const selected = await page.evaluate((taxonText) => {
        const options = Array.from(
          document.querySelectorAll(".select2-results__option")
        );
        const matchingOption = options.find(
          (option) =>
            option.textContent.trim().toLowerCase() === taxonText.toLowerCase()
        );
        if (matchingOption) {
          matchingOption.click();
          return true;
        }
        return false;
      }, taxon);

      if (selected) {
        console.log(`Successfully selected taxon: ${taxon}`);
      } else {
        console.log(`Could not find taxon: ${taxon} in dropdown, creating new`);
        await page.keyboard.press("Enter");
      }
      await delay(500);
    }
  } catch (error) {
    console.error(`Error selecting taxons: ${error.message}`);
  }
}

async function uploadSingleProduct() {
  let browser;
  let page;
  let downloadedImages = [];

  try {
    const { exchangeRate, productNumber, jsonFilePath } =
      await getConfigValues();
    console.log(`Using USD to TRY exchange rate: ${exchangeRate}`);
    const product = jsonFilePath
      ? await getSingleProductFromJson(jsonFilePath, exchangeRate)
      : generateRandomProduct(exchangeRate, productNumber);
    console.log("Product data:", product);

    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: { width: 1920, height: 1080 },
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Login
    console.log("Attempting login...");
    await page.goto(CONFIG.loginUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#spree_user_email", {
      visible: true,
      timeout: 30000,
    });
    await page.type("#spree_user_email", CONFIG.email, { delay: 100 });
    await page.type("#spree_user_password", CONFIG.password, { delay: 100 });
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
    ]);
    console.log("Login successful");

    // First page
    console.log(`Navigating to New Product page for ${product.title}...`);
    await page.goto(CONFIG.newProductUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#product_name", {
      visible: true,
      timeout: 30000,
    });
    await page.type("#product_name", product.title, { delay: 100 });
    await page.type("#product_price", product.masterPrice, { delay: 100 });
    await page.type("#product_sku", `${product.productId}_Trendyol_TR`, {
      delay: 100,
    });
    await page.select("#product_prototype_id", "1");

    const availableDate = new Date();
    availableDate.setDate(availableDate.getDate() - 2);
    const dateString = availableDate.toISOString().split("T")[0];
    await setFlatpickrDate(page, ".flatpickr-alt-input", dateString);

    await page.select("#product_shipping_category_id", "5698");
    await delay(1000);

    await page.click('button.btn.btn-success[type="submit"]');
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
      page.waitForSelector("#errorExplanation.alert-danger", {
        timeout: 10000,
      }),
    ]);

    const skuError = await page.evaluate(() => {
      const errorDiv = document.querySelector("#errorExplanation.alert-danger");
      return (
        errorDiv && errorDiv.textContent.includes("Sku has already been taken")
      );
    });

    if (skuError) {
      console.log(
        `SKU ${product.productId}_Trendyol_TR already exists. Aborting...`
      );
      return;
    }

    console.log("First page submitted");
    await page.screenshot({
      path: `first_page_${product.productId}.png`,
      fullPage: true,
    });

    // Second page
    console.log("Starting second page...");
    const editUrl = page.url();
    console.log("Edit page URL:", editUrl);

    await page.waitForSelector("#product_compare_at_price", {
      visible: true,
      timeout: 30000,
    });
    await page.evaluate(() => {
      const fields = [
        "#product_compare_at_price",
        "#product_cost_price",
        "#product_source_url",
        "#product_main_brand",
      ];
      fields.forEach((selector) => {
        const element = document.querySelector(selector);
        if (element) element.value = "";
      });
    });

    await page.type("#product_compare_at_price", product.price, { delay: 100 });
    await page.type("#product_cost_price", product.costPrice, { delay: 100 });
    await page.type("#product_source_url", product.sourceUrl, { delay: 100 });
    await page.type("#product_main_brand", product.brand, { delay: 100 });

    // Add stock
    await page.waitForSelector("#stock_movement_quantity", {
      visible: true,
      timeout: 30000,
    });
    await page.evaluate(() => {
      const element = document.querySelector("#stock_movement_quantity");
      if (element) element.value = "";
    });
    await page.type("#stock_movement_quantity", product.stock, { delay: 100 });
    await page.click('button.btn.btn-primary[type="submit"]');
    await delay(1000);

    await setFlatpickrDate(page, ".flatpickr-alt-input", dateString);
    await page.select("#product_tax_category_id", "1");

    // Handle Sync to GMC checkbox
    console.log("Handling Sync to GMC checkbox...");
    await page.waitForSelector("#product_synctogmc", {
      visible: true,
      timeout: 30000,
    });
    const isChecked = await page.evaluate(() => {
      const checkbox = document.querySelector("#product_synctogmc");
      return checkbox && checkbox.checked;
    });

    if (!isChecked) {
      await page.click("#product_synctogmc");
      console.log("Sync to GMC checkbox checked");
    }
    await delay(500);

    // Handle taxons
    const taxons = product.keywords.slice(0, 2);
    console.log("Taxons to select:", taxons);
    await selectTaxons(page, taxons);

    // Handle description
    console.log("Handling description...");
    await page.waitForSelector("#cke_product_description iframe", {
      visible: true,
      timeout: 30000,
    });
    const frameHandle = await page.$("#cke_product_description iframe");
    if (!frameHandle) throw new Error("Description iframe not found");
    const frame = await frameHandle.contentFrame();
    await frame.waitForSelector("body", { visible: true, timeout: 30000 });
    await frame.evaluate((desc) => {
      document.body.innerHTML = desc;
      document.body.style.direction = "ltr";
      document.body.style.textAlign = "left";
    }, product.description);
    await delay(1000);

    // Submit second page
    await page.waitForSelector(
      '.form-actions button.btn.btn-success[type="submit"]',
      { visible: true, timeout: 30000 }
    );
    console.log("Submitting second page...");
    await page.click('.form-actions button.btn.btn-success[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("Second page submitted");

    await page.screenshot({
      path: `second_page_${product.productId}.png`,
      fullPage: true,
    });

    console.log(`Product ${product.title} creation completed successfully`);
  } catch (error) {
    console.error("Error occurred:", error.message);
    if (page) {
      await page.screenshot({
        path: `error_${product?.productId || "unknown"}.png`,
        fullPage: true,
      });
    }
  } finally {
    for (const imagePath of downloadedImages) {
      try {
        await fsPromises.unlink(imagePath);
      } catch (err) {
        console.error(`Error deleting ${imagePath}: ${err.message}`);
      }
    }
    if (browser) await browser.close();
    console.log("Process completed");
    readline.close();
  }
}

console.log("Starting single product upload process...");
uploadSingleProduct();
