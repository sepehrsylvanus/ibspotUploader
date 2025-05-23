const puppeteer = require("puppeteer");
const fs = require("fs");
const fsPromises = require("fs").promises;
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});
const axios = require("axios");
const path = require("path");

// Utility function to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ensureLoggedIn = async (page, config) => {
  if (!page.url().includes("/admin/products")) {
    console.log("⚠️ Session expired. Logging in again...");
    await navigateWithRetry(page, config.loginUrl);
    await page.type("#spree_user_email", config.email);
    await page.type("#spree_user_password", config.password);
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation(),
    ]);
  }
};
const getSingleProductInput = async (exchangeRate) => {
  const ask = (question) =>
    new Promise((resolve) => readline.question(question, resolve));

  const title = await ask("Product title: ");
  const productId = await ask("Product ID (e.g., SKU): ");
  const usdPriceStr = await ask("USD Price (e.g., 15.00): ");
  const brand = await ask("Brand: ");
  const sourceUrl = await ask("Source URL: ");
  const description = await ask("Short description (HTML supported): ");
  const images = await ask("Image URL(s) (use ; to separate): ");
  const categories = await ask("Category path (e.g., Main>Sub): ");
  const usdPrice = parseFloat(usdPriceStr.trim()) || 15;

  return {
    title,
    productId,
    usdPrice: usdPrice.toFixed(2),
    masterPrice: (35 / exchangeRate).toFixed(2),
    costPrice: (usdPrice / exchangeRate).toFixed(2),
    price: ((35 + Math.random() * 15 + 5) / exchangeRate).toFixed(2),
    brand,
    sourceUrl,
    description,
    images,
    categories,
    specifications: [
      { name: "Color", value: "Red" },
      { name: "Size", value: "Medium" },
    ],
  };
};

const getUploadMode = () =>
  new Promise((resolve) => {
    readline.question(
      "Choose upload mode:\n1 - Upload from JSON file\n2 - Upload a single product manually\nEnter choice (1 or 2): ",
      (choice) => {
        const selected = choice.trim();
        if (selected === "2") {
          resolve("single");
        } else {
          resolve("multiple");
        }
      }
    );
  });

// Enhanced slug generation function combining title and SKU
const generateSlugFromTitleAndSku = (title, sku) => {
  const turkishToLatin = {
    ğ: "g",
    ü: "u",
    ş: "s",
    ı: "i",
    ö: "o",
    ç: "c",
    Ğ: "G",
    Ü: "U",
    Ş: "S",
    İ: "I",
    Ö: "O",
    Ç: "C",
  };

  const titlePart = title
    .replace(/[ğüşıöçĞÜŞİÖÇ]/g, (match) => turkishToLatin[match])
    .toLowerCase()
    .replace(/%100/g, "100")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${titlePart}`;
};

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

// Prompt user for starting product index
const getStartIndex = (maxProducts) =>
  new Promise((resolve) => {
    readline.question(
      `Enter the starting product index (0 to ${
        maxProducts - 1
      }, or Enter  Press Enter for 0): `,
      (index) => {
        const startIndex = parseInt(index.trim(), 10) || 0;
        if (startIndex < 0 || startIndex >= maxProducts) {
          console.log(`Invalid index, defaulting to 0`);
          resolve(0);
        } else {
          console.log(`Starting from index: ${startIndex}`);
          resolve(startIndex);
        }
      }
    );
  });

// Prompt user for category with bracket support
const getCategory = () =>
  new Promise((resolve) => {
    readline.question(
      "Enter the category to search in taxons (or press Enter for default; use [part1 part2] for hierarchical taxon): ",
      (category) => {
        const trimmedCategory = category.trim();
        if (!trimmedCategory) {
          console.log("Using default category: Saç Fırçası ve Tarak");
          resolve("Saç Fırçası ve Tarak");
        } else if (
          trimmedCategory.startsWith("[") &&
          trimmedCategory.endsWith("]")
        ) {
          const taxonParts = trimmedCategory
            .slice(1, -1)
            .match(/"([^"]+)"|\S+/g)
            .map((part) => part.replace(/(^"|"$)/g, ""));

          if (taxonParts.length >= 2) {
            console.log(`Using hierarchical taxon: ${taxonParts.join(" -> ")}`);
            resolve({ isHierarchical: true, parts: taxonParts });
          } else {
            console.log(
              `Invalid hierarchical taxon format, using as normal: ${taxonParts[0]}`
            );
            resolve(taxonParts[0]);
          }
        } else {
          console.log(`Using category: ${trimmedCategory}`);
          resolve(trimmedCategory);
        }
      }
    );
  });

// Prompt for JSON path or test mode
const getJsonPath = () =>
  new Promise((resolve) => {
    readline.question(
      "Enter path to products.json (or Enter for test mode): ",
      (pathInput) => {
        const trimmedPath = pathInput.trim().replace(/^"|"$/g, "");
        if (!trimmedPath) {
          console.log("Entering test mode.");
          const testPath = path.join(__dirname, "test_products.json");
          fsPromises.writeFile(
            testPath,
            JSON.stringify([generateTestProduct(0, 1.0)], null, 2)
          );
          resolve({ path: testPath, isTestMode: true });
        } else {
          resolve({ path: trimmedPath, isTestMode: false });
        }
      }
    );
  });

// Generate a unique test product with prices in USD
const generateTestProduct = (index, exchangeRate) => {
  const randomId = Math.floor(Math.random() * 10000);
  const categories = `BEYZANA>Kozmetik>Saç Bakımı>Saç Fırçası ve Tarak>BEYZANA Saç Fırçası ve Tarak ${index}>Tavşan Desenli Kız Çoçuğu Tarağı ${randomId}`;
  const usdPrice = (Math.random() * 100 + 50).toFixed(2);
  const costPriceUSD = parseFloat(usdPrice);
  const masterPriceUSD =
    costPriceUSD < 20
      ? (costPriceUSD + 20).toFixed(2)
      : (costPriceUSD * 2).toFixed(2);

  return {
    title: `Test Product ${index} - Tavşan Desenli Tarak ${randomId}`,
    productId: `TEST${randomId}`,
    usdPrice: usdPrice,
    masterPrice: (parseFloat(masterPriceUSD) / exchangeRate).toFixed(2),
    costPrice: (costPriceUSD / exchangeRate).toFixed(2),
    price: (
      parseFloat(masterPriceUSD) / exchangeRate +
      Math.random() * 15 +
      5
    ).toFixed(2),
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

// Load or generate products with prices in USD
const getProducts = async (jsonPath, isTestMode, exchangeRate) => {
  try {
    const data = await fsPromises.readFile(jsonPath, "utf8");
    const products = JSON.parse(data);
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error("Invalid or empty JSON file");
    }

    return products.map((p, i) => {
      const baseUsdPrice = parseFloat(p.price) / exchangeRate;
      const costPriceUSD = baseUsdPrice.toFixed(2);
      const masterPriceUSD =
        baseUsdPrice < 20
          ? (baseUsdPrice + 20).toFixed(2)
          : (baseUsdPrice * 2).toFixed(2);
      const price = (
        parseFloat(masterPriceUSD) +
        Math.random() * 15 +
        5
      ).toFixed(2);

      const testProduct = isTestMode
        ? generateTestProduct(i, exchangeRate)
        : {};

      return {
        title: String(p.title || testProduct.title || "Default Product"),
        productId: String(p.productId || testProduct.productId || "DEFAULT123"),
        usdPrice: baseUsdPrice.toFixed(2),
        masterPrice: masterPriceUSD,
        costPrice: costPriceUSD,
        price: price,
        brand: String(p.brand || testProduct.brand || "DefaultBrand"),
        sourceUrl: String(
          p.url || testProduct.sourceUrl || "https://example.com"
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

// Navigate with retry logic
const navigateWithRetry = async (page, url, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector("body", { timeout: 5000 });
      console.log(`Navigated to: ${url}`);
      return true;
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

// Select taxon in Select2 dropdown with direct Puppeteer click
const selectTaxon = async (page, categoryInput) => {
  try {
    await page.waitForSelector("#product_taxon_ids", { timeout: 5000 });
    await page.click(".select2-selection--multiple");
    await delay(500);

    let searchTerm;
    let isHierarchical = false;
    let hierarchicalParts = [];

    if (typeof categoryInput === "object" && categoryInput.isHierarchical) {
      isHierarchical = true;
      hierarchicalParts = categoryInput.parts;
      searchTerm = hierarchicalParts[hierarchicalParts.length - 1];
      console.log(`Searching taxons with final part: ${searchTerm}`);
    } else {
      searchTerm = categoryInput;
      console.log(`Attempting to select taxon: ${searchTerm}`);
    }

    await page.evaluate(() => {
      const searchField = document.querySelector(".select2-search__field");
      searchField.value = "";
      searchField.focus();
    });
    await page.type(".select2-search__field", searchTerm);
    await delay(1000);

    const availableTaxons = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".select2-results__option")).map(
        (opt) => opt.textContent.trim()
      )
    );
    console.log(`Available taxons after search: ${availableTaxons}`);

    let matchingTaxon;

    if (isHierarchical) {
      matchingTaxon = availableTaxons.find((taxon) => {
        const taxonParts = taxon.split(" -> ").map((p) => p.trim());
        if (taxonParts.length < hierarchicalParts.length) return false;

        for (let i = 0; i < hierarchicalParts.length; i++) {
          if (taxonParts[i] !== hierarchicalParts[i]) return false;
        }
        return true;
      });
    } else {
      matchingTaxon = availableTaxons.find(
        (taxon) => taxon === searchTerm || taxon.includes(searchTerm)
      );
    }

    if (matchingTaxon) {
      console.log(`Attempting to select: ${matchingTaxon}`);
      const options = await page.$$(".select2-results__option");
      let clicked = false;

      for (const option of options) {
        const text = await page.evaluate((el) => el.textContent.trim(), option);
        if (text === matchingTaxon) {
          await option.scrollIntoView();
          await option.click();
          console.log(`Clicked option: ${matchingTaxon}`);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        console.log(`Failed to find and click "${matchingTaxon}" in DOM`);
        await page.keyboard.press("Enter");
      }
    } else {
      console.log(
        `Taxon matching criteria not found for "${searchTerm}". Pressing Enter to create/select.`
      );
      await page.keyboard.press("Enter");
    }

    await delay(1500);
    const selectedTaxon = await page.evaluate(() => {
      const choices = document.querySelectorAll(".select2-selection__choice");
      return choices.length > 0
        ? Array.from(choices)
            .map((choice) => choice.textContent.trim())
            .join(", ")
        : "None";
    });
    console.log(`Final selected taxon: ${selectedTaxon}`);
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

    try {
      const extension = path.extname(new URL(url).pathname) || ".jpg"; // fallback
      const filePath = `./image_${baseIndex}_${j}${extension}`;

      const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 10000,
      });

      if (response.status !== 200) {
        console.warn(`Non-200 response for ${url}`);
        return null;
      }

      await new Promise((resolve, reject) => {
        response.data
          .pipe(fs.createWriteStream(filePath))
          .on("finish", () => resolve(filePath))
          .on("error", reject);
      });

      downloadedFiles.push(filePath);
      console.log(`Downloaded ${url} to ${filePath}`);
      return filePath;
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

// Prompt for multiple paths and taxons
const getMultipleInputs = async () => {
  const inputs = [];
  let continueInput = true;

  while (continueInput) {
    const { path, isTestMode } = await getJsonPath();
    const category = await getCategory();

    inputs.push({ path, isTestMode, category });

    await new Promise((resolve) => {
      readline.question(
        "Do you want to add another path and taxon? (yes/no): ",
        (answer) => {
          continueInput = answer.trim().toLowerCase() === "yes";
          resolve();
        }
      );
    });
  }

  return inputs;
};

// Write or update report for a single product
const writeProductReport = async (reportPath, fileName, productReport) => {
  try {
    const reportDir = path.dirname(reportPath);
    await fsPromises.mkdir(reportDir, { recursive: true });

    let report;
    if (fs.existsSync(reportPath)) {
      const existingData = await fsPromises.readFile(reportPath, "utf8");
      report = JSON.parse(existingData);
      report.products.push(productReport);
      if (["upload", "update"].includes(productReport.status)) {
        report.totalUploaded = (report.totalUploaded || 0) + 1;
      }
    } else {
      report = {
        name: fileName,
        totalUploaded: ["upload", "update"].includes(productReport.status)
          ? 1
          : 0,
        products: [productReport],
      };
    }

    await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Updated report at: ${reportPath}`);
  } catch (error) {
    console.error(`Error writing report: ${error.message}`);
  }
};

// Main product upload function with report generation
const uploadProducts = async (
  pathInput,
  isTestMode,
  predefinedCategory,
  exchangeRate,
  browser,
  startIndex
) => {
  const config = {
    email: "abrahamzhang144000@gmail.com",
    password: "Godislove153",
    loginUrl: "https://ibspot.com/admin/login",
    newProductUrl: "https://ibspot.com/admin/products/new",
  };

  const fileName = path.basename(pathInput, path.extname(pathInput));
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const reportPath = path.join(
    __dirname,
    "reports",
    `upload_report_${sanitizedFileName}_${Date.now()}.json`
  );

  try {
    const products = await getProducts(pathInput, isTestMode, exchangeRate);
    console.log(`Loaded ${products.length} products from ${pathInput}`);

    for (let i = startIndex; i < products.length; i++) {
      const product = products[i];
      console.log(
        `\nProcessing ${i + 1}/${products.length}: ${product.title} (USD: ${
          product.usdPrice
        }, Master: ${product.masterPrice}, Cost: ${product.costPrice})`
      );

      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      const downloadedFiles = [];
      let slug;
      const productSku = `${product.productId}_Trendyol_TR_FWD`;
      let editUrl;
      let status = "upload";

      try {
        await navigateWithRetry(page, config.newProductUrl);

        if (page.url().includes("/admin/login")) {
          console.log("⚠️ Not logged in. Logging in...");
          await page.type("#spree_user_email", config.email);
          await page.type("#spree_user_password", config.password);
          await Promise.all([
            page.click('input[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle2" }),
          ]);
          await navigateWithRetry(page, config.newProductUrl);
        }

        await navigateWithRetry(page, config.newProductUrl);
        await page.waitForSelector("#product_name", { timeout: 15000 });

        await page.evaluate(
          () => (document.querySelector("#product_name").value = "")
        );
        await page.type("#product_name", product.title);
        await page.type(
          "#product_price",
          parseFloat(product.masterPrice).toFixed(2)
        );
        await page.type("#product_sku", productSku);
        await page.type("#product_source_url", product.sourceUrl);

        await page.select("#product_prototype_id", "1");
        await setDate(
          page,
          "#product_available_on", // This is the actual hidden input that Flatpickr binds to
          new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0]
        );

        await page.select("#product_shipping_category_id", "5698");
        await Promise.all([
          page.click('button.btn.btn-success[type="submit"]'),
          page.waitForNavigation({ waitUntil: "networkidle2" }),
        ]);

        const skuError = await page
          .$eval("#errorExplanation", (el) =>
            el?.textContent.includes("Sku has already been taken")
          )
          .catch(() => false);
        if (skuError) {
          console.log(`SKU already taken for ${product.title}.`);
          status = "update";
          slug = generateSlugFromTitleAndSku(product.title, productSku);
          editUrl = `https://ibspot.com/admin/products/${slug}/edit`;
          await navigateWithRetry(page, editUrl);
        } else {
          slug = await getSlug(page);
          editUrl = `https://ibspot.com/admin/products/${slug}/edit`;
        }

        if (!skuError) {
          await navigateWithRetry(page, editUrl);
        }

        await page.waitForSelector("#product_compare_at_price", {
          timeout: 15000,
        });

        await setDate(
          page,
          "#product_available_on", // This is the actual hidden input that Flatpickr binds to
          new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0]
        );
        await page.type("#product_compare_at_price", product.price);
        await page.type("#product_cost_price", product.costPrice);
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
            (el) => el.nextElementSibling?.textContent?.trim() === "Sync To Gmc"
          );
          if (checkbox && !checkbox.checked) checkbox.click();
        });

        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight)
        );
        await Promise.all([
          page.click('button.btn.btn-success[type="submit"]'),
          page.waitForNavigation({ waitUntil: "networkidle2" }),
        ]);

        const imagesUrl = `https://ibspot.com/admin/products/${generateSlugFromTitleAndSku(
          product.title,
          productSku
        )}/images`;
        await navigateWithRetry(page, imagesUrl);

        const deleteButtons = await page.$$(
          '.product-image-container .actions a.btn-danger[data-action="remove"]'
        );
        if (deleteButtons.length > 0) {
          for (const button of deleteButtons) {
            page.once("dialog", async (dialog) => await dialog.accept());
            await button.click();
            await delay(1000);
          }
          console.log("All existing images deleted");
        }

        const mediaFiles = product.images
          .split(";")
          .flatMap((url) => url.split(","))
          .map((url) => url.trim())
          .filter(Boolean);

        if (mediaFiles.length) {
          await page.waitForSelector('input.upload-input[type="file"]', {
            timeout: 5000,
          });
          const downloadedPaths = await downloadMedia(mediaFiles, i);
          downloadedFiles.push(...downloadedPaths);

          const fileInput = await page.$('input.upload-input[type="file"]');
          if (fileInput && downloadedPaths.length > 0) {
            try {
              await page.evaluate((input) => {
                input.classList.remove("d-none");
                input.style.display = "block";
                input.setAttribute("multiple", "");
              }, fileInput);

              await fileInput.uploadFile(...downloadedPaths);

              try {
                await page.waitForFunction(
                  () => !document.querySelector(".pending-image-template"),
                  { timeout: 30000 }
                );
              } catch (e) {
                console.warn(
                  "⚠️ Some images may not have uploaded correctly:",
                  e.message
                );
              }

              console.log(`Uploaded ${downloadedPaths.length} images`);
            } catch (err) {
              console.warn(
                "⚠️ Skipping image upload due to error:",
                err.message
              );
            }
          } else {
            console.log("⚠️ No valid image files to upload");
          }
        }

        const slugForProperties = generateSlugFromTitleAndSku(
          product.title,
          productSku
        );
        console.log("🚀 ~ slugForProperties:", slugForProperties);
        const propertiesUrl = `https://ibspot.com/admin/products/${slugForProperties}/product_properties`;
        await navigateWithRetry(page, propertiesUrl);

        const propDeleteButtons = await page.$$(
          "#product_properties .btn-danger.delete-resource"
        );
        if (propDeleteButtons.length > 0) {
          for (const button of propDeleteButtons) {
            page.once("dialog", async (dialog) => await dialog.accept());
            await button.click();
            await delay(1000);
          }
          console.log("All existing properties deleted");
        }

        if (
          Array.isArray(product.specifications) &&
          product.specifications.length > 0
        ) {
          const addButtonSelector =
            'a.btn-success.spree_add_fields[data-target="tbody#sortVert"]';
          await page.waitForSelector(addButtonSelector, { timeout: 5000 });

          for (const spec of product.specifications) {
            if (!spec.name || !spec.value) continue;

            await page.click(addButtonSelector);
            await delay(1000);

            const rows = await page.$$("#product_properties tbody tr");
            const newRow = rows[rows.length - 1];

            const nameInput = await newRow.$("input.autocomplete.form-control");
            if (nameInput) await nameInput.type(String(spec.name));

            const valueInput = await newRow.$(
              "input.form-control:not(.autocomplete)"
            );
            if (valueInput) await valueInput.type(String(spec.value));

            const checkbox = await newRow.$('input[type="checkbox"]');
            if (
              checkbox &&
              !(await page.evaluate((el) => el.checked, checkbox))
            ) {
              await checkbox.click();
            }
          }

          const saveButton = await page.$(
            'button.btn.btn-success[type="submit"]'
          );
          if (saveButton) {
            await Promise.all([
              saveButton.click(),
              page.waitForNavigation({ waitUntil: "networkidle2" }),
            ]);
          }
        }

        const stockUrl = `https://ibspot.com/admin/products/${slugForProperties}/stock`;
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
        status = "error";
      } finally {
        const productReport = {
          productName: product.title,
          sourceURL: product.sourceUrl,
          ibspotURL: editUrl || "Error: Product creation failed",
          status: status,
        };
        await writeProductReport(reportPath, fileName, productReport);

        await Promise.all(
          downloadedFiles.map((file) =>
            fsPromises
              .unlink(file)
              .catch((err) =>
                console.error(`Error deleting ${file}: ${err.message}`)
              )
          )
        );
        await page.close(); // Close page after each product to free memory
        await delay(2000); // Add delay to reduce server load
      }
    }
  } catch (error) {
    console.error(`Critical error in uploadProducts: ${error.message}`);
    throw error;
  }
};

// Main loop to process multiple inputs
const main = async () => {
  console.log("Starting product processing...");
  const uploadMode = await getUploadMode();
  const exchangeRate = await getExchangeRate();

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--start-maximized"],
      defaultViewport: null,
    });

    if (uploadMode === "single") {
      const product = await getSingleProductInput(exchangeRate);
      const category = await getCategory();
      const pathInput = "manual_input";
      const isTestMode = false;
      const startIndex = 0;

      const tempPath = path.join(__dirname, "temp_single_product.json");
      await fsPromises.writeFile(tempPath, JSON.stringify([product], null, 2));

      await uploadProducts(
        tempPath,
        isTestMode,
        category,
        exchangeRate,
        browser,
        startIndex
      );

      await fsPromises.unlink(tempPath).catch(() => {});
    } else {
      const inputs = await getMultipleInputs();
      let sampleProducts = await getProducts(
        inputs[0].path,
        inputs[0].isTestMode,
        exchangeRate
      );
      const startIndex = await getStartIndex(sampleProducts.length);

      for (const [index, input] of inputs.entries()) {
        console.log(
          `\nProcessing input ${index + 1}/${inputs.length}: Path = ${
            input.path
          }, Category = ${JSON.stringify(input.category)}`
        );
        await uploadProducts(
          input.path,
          input.isTestMode,
          input.category,
          exchangeRate,
          browser,
          startIndex
        );
      }
    }
  } catch (error) {
    console.error(`Main loop error: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    readline.close();
    console.log("Browser closed");
  }
};

// Start the process
main();
