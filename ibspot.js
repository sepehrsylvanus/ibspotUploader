const puppeteer = require("puppeteer");
const fs = require("fs").promises;
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function getJsonFilePath() {
  return new Promise((resolve) => {
    readline.question(
      "Please enter the full path to your products.json file: ",
      (path) => {
        // Remove any surrounding quotes from the input
        const cleanedPath = path.replace(/^"|"$/g, "").trim();
        readline.close();
        resolve(cleanedPath);
      }
    );
  });
}

async function uploadProducts() {
  // Configuration - replace with your actual credentials
  const config = {
    email: "buzhijiedai@gmail.com",
    password: "Godislove153",
    loginUrl: "https://ibspot.com/admin/login",
  };

  try {
    // Get the JSON file path from user
    const jsonFilePath = await getJsonFilePath();

    // Check if the file exists before proceeding
    try {
      await fs.access(jsonFilePath);
    } catch (error) {
      throw new Error(`File not found at path: ${jsonFilePath}`);
    }

    // Read the products from the JSON file using the provided path
    const productsData = await fs.readFile(jsonFilePath, "utf8");
    const products = JSON.parse(productsData);

    // Launch browser
    const browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    const { width, height } = await page.evaluate(() => {
      return {
        width: window.screen.width,
        height: window.screen.height,
      };
    });
    await page.setViewport({ width, height });

    // Rest of your existing code...
    await page.goto(config.loginUrl, { waitUntil: "networkidle2" });
    await page.waitForSelector("#spree_user_email");
    await page.type("#spree_user_email", config.email);
    await page.type("#spree_user_password", config.password);
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);
    await page.waitForSelector(".row", { timeout: 10000 });
    await page.waitForSelector("#sidebarProduct");
    const productsAccordion = await page.$(
      '#sidebarProduct > li > a[data-toggle="collapse"]'
    );
    await productsAccordion.click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await page.waitForSelector("#sidebar-product");
    const productsLink = await page.$(
      '#sidebar-product > li > a[href="/admin/products"]'
    );
    await productsLink.click();
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    console.log("Successfully navigated to Products page");
    await page.waitForSelector("#admin_new_product", { timeout: 10000 });
    await page.click("#admin_new_product");
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    console.log("Successfully clicked 'New Product' button");

    for (const product of products) {
      await page.waitForSelector("#product_name", { timeout: 10000 });
      await page.evaluate(() => {
        document.querySelector("#product_name").value = "";
      });
      await page.type("#product_name", product.name);
      console.log(`Entered name for: ${product.name}`);
      await page.click('button[type="submit"].btn-success');
      await page.waitForNavigation({ waitUntil: "networkidle2" });
      console.log(`Successfully created: ${product.name}`);
      await page.goto("https://ibspot.com/admin/products/new", {
        waitUntil: "networkidle2",
      });
    }

    await browser.close();
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the program
uploadProducts();
