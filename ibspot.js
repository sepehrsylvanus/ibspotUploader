const puppeteer = require("puppeteer");
const fs = require("fs").promises;
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to replace waitForTimeout
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJsonFilePath() {
  return new Promise((resolve) => {
    readline.question(
      "Please enter the full path to your products.json file: ",
      (path) => {
        const cleanedPath = path.replace(/^"|"$/g, "").trim();
        readline.close();
        resolve(cleanedPath);
      }
    );
  });
}

async function uploadFirstProduct() {
  const config = {
    email: "buzhijiedai@gmail.com",
    password: "Godislove153",
    loginUrl: "https://ibspot.com/admin/login",
    newProductUrl: "https://ibspot.com/admin/products/new",
  };

  let browser;
  try {
    const jsonFilePath = await getJsonFilePath();
    try {
      await fs.access(jsonFilePath);
    } catch (error) {
      throw new Error(`File not found at path: ${jsonFilePath}`);
    }

    const productsData = await fs.readFile(jsonFilePath, "utf8");
    const products = JSON.parse(productsData);
    if (!products.length) throw new Error("No products found in the JSON file");

    const firstProduct = products[0];
    console.log("\n=== First Product Details ===");
    console.log("Title:", firstProduct.title || "Not specified");
    console.log("SKU:", firstProduct.productId || "Not specified");
    console.log("Price:", firstProduct.price || "Not specified");
    console.log("Available On:", firstProduct.available_on || "Not specified");
    console.log(
      "Shipping Category:",
      firstProduct.shipping_category || "Not specified"
    );
    console.log("===========================\n");

    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    const { width, height } = await page.evaluate(() => ({
      width: window.screen.width,
      height: window.screen.height,
    }));
    await page.setViewport({ width, height });

    // Login
    await page.goto(config.loginUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#spree_user_email", { visible: true });
    await page.type("#spree_user_email", config.email, { delay: 100 });
    await page.type("#spree_user_password", config.password, { delay: 100 });
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    // Navigate to New Product page
    console.log("Navigating directly to New Product page...");
    await page.goto(config.newProductUrl, { waitUntil: "networkidle2" });
    console.log("Successfully navigated to New Product page");

    // Debug: Check if the page loaded correctly
    const currentUrl = await page.url();
    console.log(`Current URL: ${currentUrl}`);
    if (currentUrl !== config.newProductUrl) {
      throw new Error("Failed to navigate to the New Product page");
    }

    // Fill Name
    await page.waitForSelector("#product_name", {
      visible: true,
      timeout: 30000,
    });
    await page.type("#product_name", firstProduct.title, { delay: 100 });
    const enteredNameValue = await page.$eval(
      "#product_name",
      (el) => el.value
    );
    console.log(`Title entered: ${enteredNameValue}`);

    // Fill Master Price
    await page.waitForSelector("#product_price", {
      visible: true,
      timeout: 30000,
    });
    const price = String(firstProduct.price || "");
    await page.type("#product_price", price, { delay: 100 });
    const enteredPriceValue = await page.$eval(
      "#product_price",
      (el) => el.value
    );
    console.log(`Price entered: ${enteredPriceValue}`);

    // Fill SKU
    await page.waitForSelector("#product_sku", {
      visible: true,
      timeout: 30000,
    });
    const formattedSKU = `${
      firstProduct.productId || "DEFAULT_ID"
    } Trendyol_TR`;
    await page.type("#product_sku", formattedSKU, { delay: 100 });
    const enteredSKUValue = await page.$eval("#product_sku", (el) => el.value);
    console.log(`SKU entered: ${enteredSKUValue}`);

    // Select Prototype (Default)
    console.log("Looking for Prototype select...");
    await page.waitForSelector("#product_prototype_id", {
      visible: true,
      timeout: 30000,
    });
    await page.select("#product_prototype_id", "1");
    const selectedPrototype = await page.$eval(
      "#select2-product_prototype_id-container",
      (el) => el.getAttribute("title")
    );
    console.log(`Prototype selected: ${selectedPrototype}`);

    // Set Available On (2 days before today)
    console.log("Setting Available On date...");
    let dateFieldFound = false;
    try {
      await page.waitForSelector("#product_available_on", {
        timeout: 10000,
      });
      dateFieldFound = true;
      console.log("Found #product_available_on");
    } catch (error) {
      console.log(
        "#product_available_on not found, trying .flatpickr-alt-input..."
      );
    }

    if (!dateFieldFound) {
      await page.waitForSelector(".flatpickr-alt-input", {
        visible: true,
        timeout: 30000,
      });
      console.log("Found .flatpickr-alt-input");
    }

    const today = new Date();
    today.setDate(today.getDate() - 2);
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateString = `${year}-${month}-${day}`;

    await page.click(".flatpickr-alt-input");
    await delay(500);

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
    const targetDaySelector = `.flatpickr-day[aria-label="${
      monthNames[today.getMonth()]
    } ${today.getDate()}, ${year}"]`;
    try {
      await page.waitForSelector(targetDaySelector, {
        visible: true,
        timeout: 5000,
      });
      await page.click(targetDaySelector);
      console.log(`Clicked date: ${dateString} from calendar`);
    } catch (error) {
      console.log("Calendar click failed, falling back to direct input...");
      if (dateFieldFound) {
        await page.$eval(
          "#product_available_on",
          (element, date) => {
            element.value = date;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          },
          dateString
        );
      } else {
        await page.type(".flatpickr-alt-input", dateString, { delay: 100 });
      }
    }

    const enteredDateValue = await page.$eval(
      dateFieldFound ? "#product_available_on" : ".flatpickr-alt-input",
      (el) => el.value
    );
    console.log(`Available On date set to: ${enteredDateValue}`);
    if (enteredDateValue === dateString) {
      console.log("Date successfully set and verified");
    } else {
      console.log("Warning: Date might not have been set correctly");
    }

    // Set Shipping Category (Public - TR to US by Weight)
    console.log("Setting Shipping Category...");
    await page.waitForSelector("#product_shipping_category_id", {
      visible: true,
      timeout: 30000,
    });

    await page.click("#select2-product_shipping_category_id-container");
    await delay(500);

    const targetOptionSelector = `.select2-results__option:contains("Public - TR to US by Weight")`;
    try {
      await page.waitForSelector(targetOptionSelector, {
        visible: true,
        timeout: 5000,
      });
      await page.click(targetOptionSelector);
      console.log("Selected 'Public - TR to US by Weight' from dropdown");
    } catch (error) {
      console.log("Dropdown selection failed, falling back to direct value...");
      await page.select("#product_shipping_category_id", "5698");
    }

    await delay(500);

    const selectedShipping = await page.$eval(
      "#select2-product_shipping_category_id-container",
      (el) => el.getAttribute("title")
    );
    console.log(`Shipping Category set to: ${selectedShipping}`);

    if (selectedShipping === "Public - TR to US by Weight") {
      console.log("Shipping Category successfully set and verified");
    } else {
      console.log("Error: Failed to set Shipping Category");
    }

    // Click the Create button and wait for navigation
    console.log("Attempting to click Create button...");
    await page.waitForSelector('button.btn.btn-success[type="submit"]', {
      visible: true,
      timeout: 30000,
    });

    await Promise.all([
      page.click('button.btn.btn-success[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    console.log("Create button clicked successfully");

    // Get and log the new URL after submission
    const newPageUrl = await page.url();
    console.log(`Navigated to new page: ${newPageUrl}`);

    console.log(
      "Product creation completed. Check the browser and logs for details."
    );
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    if (browser) await browser.close();
  }
}

uploadFirstProduct();
