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

// Enhanced slug generation function combining title and SKU
const generateSlugFromTitleAndSku = (title, sku) => {
  const turkishToLatin = {
    ğ: "g",
    ü: "u",
    ş: "s",
    ı: "i",
    ö: "o",
    ç: "c",
    Ğ: "g",
    Ü: "u",
    Ş: "s",
    İ: "i",
    Ö: "o",
    Ç: "c",
  };

  const titlePart = title
    .replace(/[ğüşıöçĞÜŞİÖÇ]/g, (match) => turkishToLatin[match]) // Transliterate Turkish characters
    .toLowerCase() // Convert to lowercase
    .replace(/%100/g, "100") // Convert %100 to 100
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphen
    .replace(/\s+/g, "-") // Replace spaces with hyphen
    .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
    .replace(/(^-|-$)/g, ""); // Remove leading/trailing hyphens

  return `${titlePart}`; // Append SKU with hyphen
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
            JSON.stringify([generateTestProduct(0, 1.0)], null, 2)
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
      await delay(1000 * delay);
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
    email: "abrahamzhang144000@gmail.com",
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
        }, Master: ${product.masterPrice}, Cost: ${product.costPrice})`
      );
      const downloadedFiles = [];
      let slug;
      const productSku = `${product.productId}_Trendyol_TR_FWD`; // Define SKU here

      try {
        // Step 1: Go to new product page and enter basic details
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
        await page.select("#product_prototype_id", "1");
        await setDate(
          page,
          ".flatpickr-alt-input",
          new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0]
        );
        await page.select("#product_shipping_category_id", "5698");
        await Promise.all([
          page.click('button.btn.btn-success[type="submit"]'),
          page.waitForNavigation({ waitUntil: "networkidle2" }),
        ]);

        // Check for SKU error
        const skuError = await page
          .$eval("#errorExplanation", (el) =>
            el?.textContent.includes("Sku has already been taken")
          )
          .catch(() => false);
        if (skuError) {
          console.log(`SKU already taken for ${product.title}.`);
          slug = generateSlugFromTitleAndSku(product.title, productSku);
          console.log(`Generated slug from title and SKU: ${slug}`);
          const editUrlFromTitle = `https://ibspot.com/admin/products/${slug}/edit`;
          console.log(`Navigating to edit URL: ${editUrlFromTitle}`);
          await navigateWithRetry(page, editUrlFromTitle);
        } else {
          slug = await getSlug(page);
        }
        // Step 2: Go to edit page and add taxon
        try {
          const editUrl = `https://ibspot.com/admin/products/${generateSlugFromTitleAndSku(
            product.title,
            productSku
          )}/edit`;
          if (!skuError) {
            await navigateWithRetry(page, editUrl);
          }

          await page.waitForSelector("#product_compare_at_price", {
            timeout: 15000,
          });

          // Set the "Available On" date in the Flatpickr input
          await setDate(
            page,
            ".flatpickr-alt-input",
            new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0] // 2 days ago
          );

          // Fill in other fields
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
            page.waitForNavigation({ waitUntil: "networkidle2" }),
          ]);
        } catch (editError) {
          console.error(
            `Error in edit step for ${product.title}: ${editError.message}. Proceeding to next step.`
          );
        }

        // Step 3: Upload images
        try {
          const imagesUrl = `https://ibspot.com/admin/products/${generateSlugFromTitleAndSku(
            product.title,
            productSku
          )}/images`;
          await navigateWithRetry(page, imagesUrl);

          // Attempt to delete existing images if they exist
          try {
            const deleteButtons = await page.$$(
              '.product-image-container .actions a.btn-danger[data-action="remove"]'
            );

            console.log(
              `Found ${deleteButtons.length} existing images to delete`
            );

            if (deleteButtons.length > 0) {
              for (const button of deleteButtons) {
                try {
                  // Prepare to handle the alert
                  page.once("dialog", async (dialog) => {
                    console.log(`Alert message: ${dialog.message()}`);
                    await dialog.accept(); // Click "OK" on the alert
                    console.log("Confirmed image deletion via alert");
                  });

                  // Click delete button
                  await button.click();

                  // Wait for the image to be removed
                  await delay(1000);
                } catch (deleteError) {
                  console.error(
                    `Error deleting an image: ${deleteError.message}`
                  );
                }
              }
              console.log("All existing images deleted");
            } else {
              console.log("No existing images found to delete");
            }
          } catch (noImagesError) {
            console.log(
              "No existing images detected or error checking: ",
              noImagesError.message
            );
          }

          const mediaFiles = product.images
            .split(";")
            .map((url) => url.trim())
            .filter(Boolean);

          if (!mediaFiles.length) {
            console.log(
              `No images provided for ${product.title}. Skipping image upload.`
            );
          } else {
            // Wait for the file input to be present
            await page.waitForSelector('input.upload-input[type="file"]', {
              timeout: 5000,
            });

            const downloadedPaths = await downloadMedia(mediaFiles, i);
            downloadedFiles.push(...downloadedPaths);

            // Directly interact with the file input
            const fileInput = await page.$('input.upload-input[type="file"]');
            if (fileInput) {
              // Make the input visible and enable multiple uploads if not already
              await page.evaluate((input) => {
                input.classList.remove("d-none"); // Remove 'display: none'
                input.style.display = "block"; // Ensure it’s visible
                input.setAttribute("multiple", ""); // Ensure multiple files can be uploaded
              }, fileInput);

              // Upload all files at once (since input supports 'multiple')
              await fileInput.uploadFile(...downloadedPaths);

              // Wait for all uploads to complete
              await page.waitForFunction(
                () => !document.querySelector(".pending-image-template"),
                { timeout: 30000 } // Increased timeout for multiple uploads
              );

              console.log(
                `Uploaded ${
                  downloadedPaths.length
                } images: ${downloadedPaths.join(", ")}`
              );
            } else {
              console.log("File input not found");
            }
          }
        } catch (imageError) {
          console.error(
            `Error in image upload step for ${product.title}: ${imageError.message}. Proceeding to next step.`
          );
        }

        // Step 4: Add product properties
        async function handleProductProperties(page, specifications) {
          try {
            // Navigate to the product properties page explicitly
            const currentUrl = page.url();
            const slug = currentUrl.split("/").slice(-2, -1)[0]; // Extract slug from current URL
            const propertiesUrl = `https://ibspot.com/admin/products/${slug}/product_properties`;
            await page.goto(propertiesUrl, { waitUntil: "networkidle2" });

            // Wait for the product properties table to load
            await page.waitForSelector("#product_properties", {
              timeout: 10000,
            });

            // Remove all existing properties with automatic alert handling
            const deleteButtons = await page.$$(
              "#product_properties .btn-danger.delete-resource"
            );
            console.log(
              `Found ${deleteButtons.length} existing properties to delete`
            );

            if (deleteButtons.length > 0) {
              for (const button of deleteButtons) {
                try {
                  // Prepare to handle the alert
                  page.once("dialog", async (dialog) => {
                    console.log(`Alert message: ${dialog.message()}`);
                    await dialog.accept(); // Automatically click "OK" on the alert
                    console.log("Confirmed property deletion via alert");
                  });

                  // Click delete button
                  await button.click();

                  // Wait for the property to be removed
                  await delay(1000);
                } catch (deleteError) {
                  console.error(
                    `Error deleting a property: ${deleteError.message}`
                  );
                }
              }
              console.log("All existing properties deleted");
            } else {
              console.log("No existing properties found to delete");
            }

            // Wait for deletions to process
            await page.waitForTimeout(2000);

            // Add new properties from specifications (array format)
            if (Array.isArray(specifications) && specifications.length > 0) {
              const addButtonSelector =
                'a.btn-success.spree_add_fields[data-target="tbody#sortVert"]';
              await page.waitForSelector(addButtonSelector, { timeout: 5000 });

              for (const spec of specifications) {
                if (!spec.name || !spec.value) continue; // Skip invalid specs

                // Click the Add Product Properties button
                await page.click(addButtonSelector);
                await page.waitForTimeout(1000); // Wait for new row to appear

                // Find the last row (newly added)
                const rows = await page.$$("#product_properties tbody tr");
                const newRow = rows[rows.length - 1];

                // Fill in property name
                const nameInput = await newRow.$(
                  "input.autocomplete.form-control"
                );
                if (nameInput) {
                  await nameInput.click();
                  await nameInput.type(String(spec.name));
                }

                // Fill in property value
                const valueInput = await newRow.$(
                  "input.form-control:not(.autocomplete)"
                );
                if (valueInput) {
                  await valueInput.click();
                  await valueInput.type(String(spec.value));
                }

                // Ensure show_property checkbox is checked
                const checkbox = await newRow.$('input[type="checkbox"]');
                if (checkbox) {
                  const isChecked = await page.evaluate(
                    (el) => el.checked,
                    checkbox
                  );
                  if (!isChecked) {
                    await checkbox.click();
                  }
                }

                await page.waitForTimeout(500); // Small delay between additions
              }

              // Save changes
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

            console.log("Product properties updated successfully");
          } catch (error) {
            console.error("Error handling product properties:", error);
            throw error; // Let the caller handle the error
          }
        }

        try {
          await handleProductProperties(page, product.specifications);
        } catch (error) {
          console.error(
            `Failed to handle properties for ${product.title}: ${error.message}`
          );
        }

        // Step 5: Set stock with delay
        const stockUrl = `https://ibspot.com/admin/products/${generateSlugFromTitleAndSku(
          product.title,
          productSku
        )}/stock`;
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
