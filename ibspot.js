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

// Prompts user for exchange rate
async function getExchangeRate() {
  return new Promise((resolve) => {
    readline.question(
      "Enter the exchange rate (local currency to USD, e.g., 31.50 for TRY to USD): ",
      (rate) => {
        const parsedRate = parseFloat(rate);
        if (isNaN(parsedRate) || parsedRate <= 0) {
          console.log("Invalid rate, defaulting to 1 (no conversion).");
          resolve(1);
        } else {
          resolve(parsedRate);
        }
      }
    );
  });
}

// Adjusts price based on rules and converts to USD
function adjustPrice(originalPrice, exchangeRate) {
  const priceNum = parseFloat(originalPrice) / exchangeRate; // Convert to USD
  if (isNaN(priceNum)) return adjustPrice("10", exchangeRate);
  return priceNum < 20 ? (priceNum + 20).toFixed(2) : (priceNum * 2).toFixed(2);
}

// Generates random number between min and max (inclusive)
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Gets Taxons from categories with ensured array return
function getTaxonsFromCategories(categories) {
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return ["General", "Product"];
  }
  return categories.slice(0, 2);
}

// Downloads image from URL to specified filepath
async function downloadImage(url, filepath) {
  try {
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
    });
    return new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(filepath))
        .on("finish", resolve)
        .on("error", reject);
    });
  } catch (error) {
    throw new Error(`Failed to download image from ${url}: ${error.message}`);
  }
}

// Generates a random product with USD conversion
function generateRandomProduct(exchangeRate) {
  const randomNum = Math.floor(Math.random() * 10000);
  const basePriceLocal = (Math.random() * 100 + 10).toFixed(2); // Assume local currency
  const basePrice = (parseFloat(basePriceLocal) / exchangeRate).toFixed(2); // Convert to USD
  const masterPrice = adjustPrice(basePrice, 1); // Already in USD, no further conversion
  const additionalAmount = getRandomNumber(5, 20);
  const price = (parseFloat(masterPrice) + additionalAmount).toFixed(2);

  const possibleCategories = [
    "Electronics",
    "Clothing",
    "Home",
    "Toys",
    "Books",
  ];
  const categories = [
    possibleCategories[Math.floor(Math.random() * possibleCategories.length)],
    possibleCategories[Math.floor(Math.random() * possibleCategories.length)],
  ];

  return {
    title: `Test Product ${randomNum}`,
    productId: `TEST${randomNum}`,
    masterPrice: String(masterPrice),
    price: String(price),
    costPrice: String(basePrice),
    brand: `Brand${randomNum}`,
    sourceUrl: `https://example.com/product/${randomNum}`,
    description: `<div style="font-family: Arial, sans-serif;"><h2>Test Product ${randomNum}</h2><p>This is a <strong>feature-rich</strong> product.</p></div>`,
    images: "",
    categories,
    specifications: [],
    stock: "100",
  };
}

// Reads product from JSON with USD conversion
async function getProductFromJson(jsonFilePath, exchangeRate) {
  try {
    const jsonData = await fsPromises.readFile(jsonFilePath, "utf8");
    const products = JSON.parse(jsonData);
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error("JSON file is empty or not an array");
    }

    const firstProduct = products[103] || {};
    const basePriceLocal = String(firstProduct.price || "10"); // Assume local currency
    const basePrice = (parseFloat(basePriceLocal) / exchangeRate).toFixed(2); // Convert to USD
    const masterPrice = adjustPrice(basePrice, 1); // Already in USD
    const additionalAmount = getRandomNumber(5, 20);
    const price = (parseFloat(masterPrice) + additionalAmount).toFixed(2);

    return {
      title: String(
        firstProduct.title ||
          `Test Product ${Math.floor(Math.random() * 10000)}`
      ),
      productId: String(
        firstProduct.productId || `TEST${Math.floor(Math.random() * 10000)}`
      ),
      masterPrice: String(masterPrice),
      price: String(price),
      costPrice: String(basePrice),
      brand: String(
        firstProduct.brand || `Brand${Math.floor(Math.random() * 10000)}`
      ),
      sourceUrl: String(
        firstProduct.sourceUrl ||
          `https://example.com/product/${Math.floor(Math.random() * 10000)}`
      ),
      description: String(
        firstProduct.description || "<p>Default description</p>"
      ),
      images: String(firstProduct.images || ""),
      categories: Array.isArray(firstProduct.categories)
        ? firstProduct.categories
        : ["General", "Product"],
      specifications: Array.isArray(firstProduct.specifications)
        ? firstProduct.specifications
        : [],
      stock: String(firstProduct.stock || "100"),
    };
  } catch (error) {
    console.log(`Error reading JSON: ${error.message}. Using random product.`);
    return generateRandomProduct(exchangeRate);
  }
}

// Prompts user for JSON file path
async function getJsonFilePath() {
  return new Promise((resolve) => {
    readline.question(
      "Enter the full path to your products.json file (or press Enter for random): ",
      (path) => {
        resolve(path.trim().replace(/^"|"$/g, ""));
      }
    );
  });
}

// Sets date in Flatpickr
async function setFlatpickrDate(page, selector, dateString) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: 30000 });
    await page.click(selector);
    await delay(500);

    const date = new Date(dateString);
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const ariaLabel = `${
      monthNames[date.getMonth()]
    } ${date.getDate()}, ${date.getFullYear()}`;

    await page.waitForSelector(`.flatpickr-day[aria-label="${ariaLabel}"]`, {
      visible: true,
      timeout: 10000,
    });
    await page.click(`.flatpickr-day[aria-label="${ariaLabel}"]`);
    await delay(500);
  } catch (error) {
    console.error(`Error setting Flatpickr date: ${error.message}`);
  }
}

// Extracts slug from URL
async function getProductSlug(page) {
  await delay(1000);
  const currentUrl = page.url();
  console.log("Current URL:", currentUrl);
  const urlParts = currentUrl.split("/admin/products/");
  if (urlParts.length > 1) {
    return urlParts[1].split("/")[0];
  }
  throw new Error("Could not extract slug from URL");
}

// Main function to upload product
async function uploadProduct() {
  const config = {
    email: "buzhijiedai@gmail.com",
    password: "Godislove153",
    loginUrl: "https://ibspot.com/admin/login",
    newProductUrl: "https://ibspot.com/admin/products/new",
  };

  let browser;
  let page;
  let downloadedImages = [];

  try {
    // Get exchange rate first
    const exchangeRate = await getExchangeRate();
    console.log(`Using exchange rate: ${exchangeRate} (local currency to USD)`);

    const jsonFilePath = await getJsonFilePath();
    const product = jsonFilePath
      ? await getProductFromJson(jsonFilePath, exchangeRate)
      : generateRandomProduct(exchangeRate);
    console.log("Product data (in USD):", product);

    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      defaultViewport: null,
    });
    page = await browser.newPage();
    console.log("Page created");
    await page.setViewport({ width: 1920, height: 1080 });

    // Login
    console.log("Attempting login...");
    await page.goto(config.loginUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#spree_user_email", {
      visible: true,
      timeout: 30000,
    });
    await page.type("#spree_user_email", config.email, { delay: 0 });
    await page.type("#spree_user_password", config.password, { delay: 0 });
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
    ]);
    console.log("Login successful");

    // First page
    console.log("Navigating to New Product page...");
    await page.goto(config.newProductUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#product_name", {
      visible: true,
      timeout: 30000,
    });

    await page.type("#product_name", product.title, { delay: 0 });
    await page.type("#product_price", product.masterPrice, { delay: 0 });
    await page.type("#product_sku", `${product.productId} Trendyol_TR`, {
      delay: 0,
    });
    await page.select("#product_prototype_id", "1");

    const availableDate = new Date();
    availableDate.setDate(availableDate.getDate() - 2);
    const dateString = availableDate.toISOString().split("T")[0];
    await setFlatpickrDate(page, ".flatpickr-alt-input", dateString);

    await page.select("#product_shipping_category_id", "5698");
    await delay(500);

    await page.click('button.btn.btn-success[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("First page submitted");

    await page.screenshot({
      path: "first_page_screenshot.png",
      fullPage: true,
    });

    // Second page
    console.log("Starting second page...");
    const editUrl = page.url();
    console.log("Edit page URL:", editUrl);

    // Increase timeout and add fallback
    const comparePriceSelector = "#product_compare_at_price";
    try {
      await page.waitForSelector(comparePriceSelector, {
        visible: true,
        timeout: 60000,
      });
      console.log("Second page loaded successfully");
    } catch (e) {
      console.error(`Failed to find ${comparePriceSelector}: ${e.message}`);
      await page.screenshot({ path: "second_page_error.png", fullPage: true });
      throw new Error("Second page load failed");
    }

    await page.type("#product_compare_at_price", product.price, { delay: 0 });
    await page.type("#product_cost_price", product.costPrice, { delay: 0 });
    await page.type("#product_source_url", product.sourceUrl, { delay: 0 });
    await page.type("#product_main_brand", product.brand, { delay: 0 });

    // Add stock quantity using the correct selector
    await page.waitForSelector("#stock_movement_quantity", {
      visible: true,
      timeout: 30000,
    });
    await page.type("#stock_movement_quantity", product.stock, { delay: 0 });
    await page.click('button.btn.btn-primary[type="submit"]'); // Click the Add Stock button
    await delay(1000); // Wait for stock to be added

    await setFlatpickrDate(page, ".flatpickr-alt-input", dateString);
    await page.select("#product_tax_category_id", "1");

    const taxons = getTaxonsFromCategories(product.categories);
    console.log("Taxons:", taxons);
    for (const taxon of taxons) {
      await page.waitForSelector(".select2-search__field", {
        visible: true,
        timeout: 30000,
      });
      await page.type(".select2-search__field", taxon, { delay: 0 });
      await delay(500);
      await page.keyboard.press("Enter");
      await delay(500);
    }

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
    }, product.description);
    await delay(500);

    // Sync to GMC checkbox
    console.log("Checking Sync to GMC...");
    await page.evaluate(() => {
      const checkbox = Array.from(
        document.querySelectorAll('input[type="checkbox"]')
      ).find(
        (el) => el.nextElementSibling?.textContent?.trim() === "Sync To Gmc"
      );
      if (checkbox && !checkbox.checked) checkbox.click();
    });
    await delay(500);

    // Click specific Update button
    console.log("Submitting second page...");
    await page.waitForSelector(
      '.form-actions button.btn.btn-success[type="submit"]',
      {
        visible: true,
        timeout: 30000,
      }
    );
    await page.click('.form-actions button.btn.btn-success[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("Second page submitted");

    await page.screenshot({
      path: "second_page_screenshot.png",
      fullPage: true,
    });

    // Images page
    console.log("Navigating to Images page...");
    const slug = await getProductSlug(page);
    const imagesUrl = `https://ibspot.com/admin/products/${slug}/images`;
    await page.goto(imagesUrl, { waitUntil: "networkidle2" });
    await delay(1000);

    // Handle images
    const imageFiles = product.images
      .split(";")
      .map((url) => url.trim())
      .filter(Boolean);
    console.log(`Found ${imageFiles.length} images to process`);

    if (imageFiles.length > 0) {
      for (let i = 0; i < imageFiles.length; i++) {
        const imageSource = imageFiles[i];
        const imagePath = `./image_${i}.png`;

        if (!imageSource.startsWith("http")) {
          console.log(`Skipping invalid URL ${i + 1}: ${imageSource}`);
          continue;
        }

        try {
          console.log(`Processing image ${i + 1} from ${imageSource}`);
          await downloadImage(imageSource, imagePath);
          downloadedImages.push(imagePath);

          await page.waitForSelector(".image-placeholder .card", {
            visible: true,
            timeout: 30000,
          });
          await page.click(".image-placeholder .card");
          await delay(500);

          const fileInput = await page.$('input[type="file"]');
          await fileInput.uploadFile(imagePath);

          await delay(5000); // Wait for upload to process

          console.log(`Image ${i + 1} uploaded successfully`);
        } catch (imageError) {
          console.error(
            `Error processing image ${i + 1}: ${imageError.message}`
          );
        }
      }
    }

    await page.screenshot({
      path: "images_page_screenshot.png",
      fullPage: true,
    });

    // Product Properties page
    console.log("Navigating to Product Properties page...");
    const propertiesUrl = `https://ibspot.com/admin/products/${slug}/product_properties`;
    await page.goto(propertiesUrl, { waitUntil: "networkidle2" });
    await delay(1000);

    if (product.specifications && product.specifications.length > 0) {
      console.log("Adding product specifications...");
      for (const spec of product.specifications) {
        try {
          await page.waitForSelector("table", {
            visible: true,
            timeout: 30000,
          });
          await page.waitForSelector(".spree_add_fields.btn-success", {
            visible: true,
            timeout: 30000,
          });
          await page.click(".spree_add_fields.btn-success");
          await delay(500);

          const rows = await page.$$("table tbody tr");
          const lastRow = rows[rows.length - 1];

          const nameInput = await lastRow.$("td:nth-child(2) input");
          if (nameInput) await nameInput.type(spec.name || "", { delay: 0 });

          const valueInput = await lastRow.$("td:nth-child(3) input");
          if (valueInput) await valueInput.type(spec.value || "", { delay: 0 });

          await delay(500);
          console.log(`Added specification: ${spec.name} = ${spec.value}`);
        } catch (specError) {
          console.error(
            `Error adding specification ${spec.name}: ${specError.message}`
          );
        }
      }

      await page.click('.form-actions button.btn.btn-success[type="submit"]');
      await page.waitForNavigation({
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      console.log("Product properties updated");

      await page.screenshot({
        path: "properties_page_screenshot.png",
        fullPage: true,
      });
    }

    console.log("Product creation completed successfully");
  } catch (error) {
    console.error("Error:", error.message);
    if (page) {
      await page.screenshot({ path: "error_screenshot.png", fullPage: true });
    } else {
      console.error("Page not initialized due to earlier error.");
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
    readline.close(); // Close readline after process ends
  }
}

console.log("Starting product upload process...");
uploadProduct();
