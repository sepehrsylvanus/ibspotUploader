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

// Prompts user for USD to TRY exchange rate
async function getUserExchangeRate() {
  return new Promise((resolve) => {
    readline.question(
      "Enter the USD to TRY exchange rate (e.g., 37.06): ",
      (input) => {
        const rate = parseFloat(input.trim());
        if (isNaN(rate) || rate <= 0) {
          console.log("Invalid rate provided. Using default rate of 37.06.");
          resolve(37.06);
        } else {
          resolve(rate);
        }
      }
    );
  });
}

// Adjusts price based on rules (assumes originalPrice is in TRY, converts to USD)
function adjustPrice(originalPrice, exchangeRate) {
  const priceNumInTRY = parseFloat(originalPrice);
  if (isNaN(priceNumInTRY)) return adjustPrice("370.60", exchangeRate); // Default 10 USD * 37.06
  const priceNumInUSD = priceNumInTRY / exchangeRate; // Convert TRY to USD
  return priceNumInUSD < 20
    ? (priceNumInUSD + 20).toFixed(2) // Add 20 USD if < 20 USD
    : (priceNumInUSD * 2).toFixed(2); // Double if >= 20 USD
}

// Generates random number between min and max (inclusive)
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Prompts user for custom keywords for taxons
async function getCustomKeywords() {
  return new Promise((resolve) => {
    readline.question(
      "Enter custom keywords for taxons (comma-separated, e.g., Electronics, Gadgets) or press Enter for defaults: ",
      (input) => {
        const keywords = input
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        resolve(keywords.length > 0 ? keywords : ["General", "Product"]);
      }
    );
  });
}

// Gets Taxons from keywords with ensured array return
function getTaxonsFromKeywords(keywords) {
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return ["General", "Product"];
  }
  return keywords.slice(0, 2);
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

// Generates a random product (prices in TRY, converted to USD)
function generateRandomProduct(exchangeRate, customKeywords) {
  const randomNum = Math.floor(Math.random() * 10000);
  const basePriceInTRY = (Math.random() * 3706 + 370.6).toFixed(2); // Random between 10-100 USD in TRY (370.6 - 3706 TRY at 37.06 rate)
  const basePriceInUSD = (basePriceInTRY / exchangeRate).toFixed(2);
  const masterPriceInUSD = adjustPrice(basePriceInTRY, exchangeRate); // In USD
  const additionalAmount = getRandomNumber(5, 20); // Additional in USD
  const priceInUSD = (parseFloat(masterPriceInUSD) + additionalAmount).toFixed(
    2
  );

  const keywords =
    customKeywords.length > 0
      ? customKeywords
      : ["Electronics", "Clothing", "Home", "Toys", "Books"].slice(0, 2);

  return {
    title: `Test Product ${randomNum}`,
    productId: `TEST${randomNum}`,
    masterPrice: String(masterPriceInUSD), // In USD
    price: String(priceInUSD), // In USD
    costPrice: String(basePriceInUSD), // In USD
    brand: `Brand${randomNum}`,
    sourceUrl: `https://example.com/product/${randomNum}`,
    description: `<div dir="ltr" style="font-family: Arial, sans-serif; text-align: left;"><h2>Test Product ${randomNum}</h2><p>This is a <strong>feature-rich</strong> product.</p></div>`,
    images: "",
    keywords,
    specifications: [],
    stock: "100",
    rating: String(getRandomNumber(1, 5)),
  };
}

// Reads all products from JSON with fallback to random product
async function getProductsFromJson(jsonFilePath, exchangeRate, customKeywords) {
  try {
    const jsonData = await fsPromises.readFile(jsonFilePath, "utf8");
    const products = JSON.parse(jsonData);
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error("JSON file is empty or not an array");
    }

    return products.map((product) => {
      const basePriceInTRY = String(product.price || "370.60"); // Assume TRY, default 10 USD * 37.06
      const basePriceInUSD = (
        parseFloat(basePriceInTRY) / exchangeRate
      ).toFixed(2);
      const masterPriceInUSD = adjustPrice(basePriceInTRY, exchangeRate); // In USD
      const additionalAmount = getRandomNumber(5, 20); // In USD
      const priceInUSD = (
        parseFloat(masterPriceInUSD) + additionalAmount
      ).toFixed(2);

      return {
        title: String(
          product.title || `Test Product ${Math.floor(Math.random() * 10000)}`
        ),
        productId: String(
          product.productId || `TEST${Math.floor(Math.random() * 10000)}`
        ),
        masterPrice: String(masterPriceInUSD), // In USD
        price: String(priceInUSD), // In USD
        costPrice: String(basePriceInUSD), // In USD
        brand: String(
          product.brand || `Brand${Math.floor(Math.random() * 10000)}`
        ),
        sourceUrl: String(
          product.sourceUrl ||
            `https://example.com/product/${Math.floor(Math.random() * 10000)}`
        ),
        description: String(
          product.description
            ? `<div dir="ltr" style="text-align: left;">${product.description}</div>`
            : '<div dir="ltr" style="text-align: left;"><p>Default description</p></div>'
        ),
        images: String(product.images || ""),
        keywords: Array.isArray(product.keywords)
          ? product.keywords
          : customKeywords,
        specifications: Array.isArray(product.specifications)
          ? product.specifications
          : [],
        stock: String(product.stock || "100"),
        rating: String(product.rating || getRandomNumber(1, 5)),
      };
    });
  } catch (error) {
    console.log(`Error reading JSON: ${error.message}. Using random product.`);
    return [generateRandomProduct(exchangeRate, customKeywords)];
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

// Uploads a single product
async function uploadSingleProduct(page, product, config) {
  let downloadedImages = [];

  try {
    console.log(`Navigating to New Product page for ${product.title}...`);
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

    // Submit the first page and check for SKU error
    await page.click('button.btn.btn-success[type="submit"]');
    await Promise.race([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }),
      page.waitForSelector("#errorExplanation.alert-danger", {
        timeout: 10000,
      }), // Look for the error div
    ]);

    // Check if the specific SKU error exists
    const skuError = await page.evaluate(() => {
      const errorDiv = document.querySelector("#errorExplanation.alert-danger");
      if (
        errorDiv &&
        errorDiv.textContent.includes("Sku has already been taken")
      ) {
        return true;
      }
      return false;
    });

    if (skuError) {
      console.log(
        `SKU ${product.productId} Trendyol_TR already exists. Skipping to next product...`
      );
      return; // Exit immediately and move to the next product
    }

    console.log("First page submitted");

    await page.screenshot({
      path: `first_page_${product.productId}.png`,
      fullPage: true,
    });

    console.log("Starting second page...");
    const editUrl = page.url();
    console.log("Edit page URL:", editUrl);

    await page.waitForSelector("#product_compare_at_price", {
      visible: true,
      timeout: 30000,
    });

    await page.type("#product_compare_at_price", product.price, { delay: 0 });
    await page.type("#product_cost_price", product.costPrice, { delay: 0 });
    await page.type("#product_main_brand", product.brand, { delay: 0 });
    await page.type("#product_source_url", product.sourceUrl, { delay: 0 });
    await page.type("#product_stock_total", product.stock, { delay: 0 });

    await setFlatpickrDate(page, ".flatpickr-alt-input", dateString);
    await page.select("#product_tax_category_id", "1");

    const taxons = getTaxonsFromKeywords(product.keywords);
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
    await delay(500);

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

    await page.waitForSelector(
      '.form-actions button.btn.btn-success[type="submit"]',
      { visible: true, timeout: 30000 }
    );
    await page.click('.form-actions button.btn.btn-success[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    console.log("Second page submitted");

    await page.screenshot({
      path: `second_page_${product.productId}.png`,
      fullPage: true,
    });

    console.log("Navigating to Images page...");
    const slug = await getProductSlug(page);
    const imagesUrl = `https://ibspot.com/admin/products/${slug}/images`;
    await page.goto(imagesUrl, { waitUntil: "networkidle2" });
    await delay(1000);

    const imageFiles = product.images
      .split(";")
      .map((url) => url.trim())
      .filter(Boolean);
    console.log(`Found ${imageFiles.length} images to process`);

    if (imageFiles.length > 0) {
      for (let i = 0; i < imageFiles.length; i++) {
        const imageSource = imageFiles[i];
        const imagePath = `./image_${product.productId}_${i}.png`;

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

          await delay(5000);
          console.log(`Image ${i + 1} uploaded successfully`);
        } catch (imageError) {
          console.error(
            `Error processing image ${i + 1}: ${imageError.message}`
          );
        }
      }
    }

    await page.screenshot({
      path: `images_page_${product.productId}.png`,
      fullPage: true,
    });

    console.log("Navigating to Product Properties page...");
    const propertiesUrl = `https://ibspot.com/admin/products/${slug}/product_properties`;
    await page.goto(propertiesUrl, { waitUntil: "networkidle2" });
    await delay(1000);

    const specifications = [
      ...product.specifications,
      { name: "Rating", value: product.rating },
    ];
    if (specifications.length > 0) {
      console.log("Adding product specifications and rating...");
      for (const spec of specifications) {
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
    }

    await page.screenshot({
      path: `properties_page_${product.productId}.png`,
      fullPage: true,
    });

    console.log(`Product ${product.title} creation completed successfully`);
  } catch (error) {
    console.error(`Error processing ${product.title}: ${error.message}`);
    await page.screenshot({
      path: `error_${product.productId}.png`,
      fullPage: true,
    });
  } finally {
    for (const imagePath of downloadedImages) {
      try {
        await fsPromises.unlink(imagePath);
      } catch (err) {
        console.error(`Error deleting ${imagePath}: ${err.message}`);
      }
    }
  }
}

// Main function to upload all products
async function uploadAllProducts() {
  const config = {
    email: "buzhijiedai@gmail.com",
    password: "Godislove153",
    loginUrl: "https://ibspot.com/admin/login",
    newProductUrl: "https://ibspot.com/admin/products/new",
  };

  let browser;
  try {
    const exchangeRate = await getUserExchangeRate();
    console.log(`Using USD to TRY exchange rate: ${exchangeRate}`);
    const customKeywords = await getCustomKeywords();
    const jsonFilePath = await getJsonFilePath();
    const products = jsonFilePath
      ? await getProductsFromJson(jsonFilePath, exchangeRate, customKeywords)
      : [generateRandomProduct(exchangeRate, customKeywords)];
    console.log(`Found ${products.length} products to process`);

    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      defaultViewport: null,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

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

    for (const [index, product] of products.entries()) {
      console.log(
        `Processing product ${index + 1} of ${products.length}: ${
          product.title
        }`
      );
      await uploadSingleProduct(page, product, config);
      await delay(2000);
    }

    console.log("All products processed successfully");
  } catch (error) {
    console.error("Error in main process:", error.message);
  } finally {
    if (browser) await browser.close();
    readline.close();
    console.log("Process completed");
  }
}

console.log("Starting product upload process...");
uploadAllProducts();
