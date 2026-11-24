
const express = require("express");
require("dotenv").config();
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");
const bcrypt = require("bcryptjs");

const {
  CLOSED_SYSTEM_PATTERN,
  describeRate,
} = require("./plaza-classification");

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// PostgreSQL-backed developer login sessions
app.set("trust proxy", 1);

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    name: "raastatoll.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.json());

async function authenticateApiKey(req, res, next) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: "API key is required."
      });
    }

    const apiKeyHash = crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex");

    // Verify the API key and customer status
    const result = await pool.query(
      `SELECT id, client_name, daily_limit
       FROM api_clients
       WHERE api_key_hash = $1
         AND active = TRUE`,
      [apiKeyHash]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid or inactive API key."
      });
    }

    const client = result.rows[0];

    // Atomically increment today's request count
    const usageResult = await pool.query(
      `INSERT INTO api_usage (client_id, usage_date, request_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (client_id, usage_date)
       DO UPDATE
       SET request_count = api_usage.request_count + 1
       WHERE api_usage.request_count < $2
       RETURNING request_count`,
      [client.id, client.daily_limit]
    );

    // No row returned means the daily limit has been reached
    if (usageResult.rowCount === 0) {
      return res.status(429).json({
        success: false,
        message: "Daily API request limit exceeded.",
        daily_limit: client.daily_limit
      });
    }

    req.apiClient = client;
    req.apiUsage = usageResult.rows[0].request_count;

    next();

  } catch (error) {
    console.error("API authentication error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Authentication service error."
    });
  }
}


function authenticateAdmin(req, res, next) {
  if (!req.session?.admin) {
    return res.status(401).json({
      success: false,
      message: "Admin authentication required."
    });
  }

  next();
}


app.post("/api/v1/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required."
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain 1 to 100 characters."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address."
      });
    }

    if (
      password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters and at most 72 bytes."
      });
    }

    // Hash password and generate API key
    const passwordHash = await bcrypt.hash(password, 12);
    const apiKey = crypto.randomBytes(32).toString("hex");
    const apiKeyHash = crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex");

    // Create customer with fixed daily quota
    const result = await pool.query(
      `INSERT INTO api_clients
       (client_name, email, password_hash, api_key_hash, active, daily_limit)
       VALUES ($1, $2, $3, $4, TRUE, 100)
       RETURNING id, client_name, email, daily_limit`,
      [cleanName, cleanEmail, passwordHash, apiKeyHash]
    );

    const customer = result.rows[0];

    // Automatically log in the newly registered developer
    req.session.user = {
      id: customer.id,
      name: customer.client_name,
      email: customer.email
    };

    req.session.save((error) => {
      if (error) {
        console.error("Session save error:", error.message);

        return res.status(500).json({
          success: false,
          message: "Account created, but login session could not be saved. Please log in."
        });
      }

      return res.status(201).json({
        success: true,
        message: "Registration successful.",
        customer,
        api_key: apiKey,
        daily_limit: 100,
        warning: "Copy and save your API key securely. It will not be displayed again."
      });
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration failed. Please try again."
    });
  }
});


// Developer login
app.post("/api/v1/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT id, client_name, email, password_hash
       FROM api_clients
       WHERE LOWER(email) = $1
         AND active = TRUE`,
      [cleanEmail]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const customer = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      customer.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    // Regenerate session after successful authentication
    req.session.regenerate((error) => {
      if (error) {
        console.error("Session regeneration error:", error.message);

        return res.status(500).json({
          success: false,
          message: "Login failed. Please try again."
        });
      }

      req.session.user = {
        id: customer.id,
        name: customer.client_name,
        email: customer.email
      };

      req.session.save((saveError) => {
        if (saveError) {
          console.error("Session save error:", saveError.message);

          return res.status(500).json({
            success: false,
            message: "Could not create login session."
          });
        }

        return res.json({
          success: true,
          message: "Login successful.",
          user: req.session.user
        });
      });
    });

  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Login failed."
    });
  }
});


// Get currently logged-in developer
app.get("/api/v1/auth/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: "Please log in."
    });
  }

  return res.json({
    success: true,
    user: req.session.user
  });
});


app.get("/api/v1/auth/usage", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in."
      });
    }

    const customerId = req.session.user.id;

    const customerResult = await pool.query(
      `SELECT id, client_name, email, daily_limit
       FROM api_clients
       WHERE id = $1 AND active = TRUE`,
      [customerId]
    );

    if (customerResult.rowCount === 0) {
      return res.status(403).json({
        success: false,
        message: "Account is inactive or unavailable."
      });
    }

    const usageResult = await pool.query(
      `SELECT
         c.daily_limit,
         COALESCE(u.request_count, 0)::int AS requests_used,
         GREATEST(
           c.daily_limit - COALESCE(u.request_count, 0),
           0
         )::int AS requests_remaining
       FROM api_clients c
       LEFT JOIN api_usage u
         ON u.client_id = c.id
         AND u.usage_date = CURRENT_DATE
       WHERE c.id = $1`,
      [customerId]
    );

    const historyResult = await pool.query(
      `SELECT usage_date, request_count
       FROM api_usage
       WHERE client_id = $1
         AND usage_date >= CURRENT_DATE - 6
       ORDER BY usage_date DESC`,
      [customerId]
    );

    return res.json({
      success: true,
      customer: customerResult.rows[0],
      today: usageResult.rows[0],
      usage_history: historyResult.rows
    });

  } catch (error) {
    console.error("Developer usage error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not retrieve usage information."
    });
  }
});


app.post("/api/v1/auth/regenerate-key", async (req, res) => {
  try {
    // Only logged-in developers can regenerate their own key.
    if (!req.session.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in first."
      });
    }

    const clientId = req.session.user.id;

    // Generate a new API key and hash it before storing.
    const apiKey = crypto.randomBytes(32).toString("hex");

    const apiKeyHash = crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const result = await pool.query(
      `UPDATE api_clients
       SET api_key_hash = $1
       WHERE id = $2 AND active = TRUE
       RETURNING id`,
      [apiKeyHash, clientId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Active API account not found."
      });
    }

    return res.json({
      success: true,
      message: "API key regenerated successfully.",
      api_key: apiKey,
      warning: "Your previous API key is now invalid. Save this new key securely."
    });

  } catch (error) {
    console.error("API key regeneration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not regenerate API key. Please try again."
    });
  }
});

// Developer logout
app.post("/api/v1/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Logout error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Logout failed."
      });
    }

    res.clearCookie("raastatoll.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    });

    return res.json({
      success: true,
      message: "Logged out successfully."
    });
  });
});

app.post("/api/v1/admin/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminEmail || !adminPasswordHash) {
      return res.status(500).json({
        success: false,
        message: "Admin authentication is not configured."
      });
    }

    const validEmail =
      email.trim().toLowerCase() === adminEmail;

    const validPassword = await bcrypt.compare(
      password,
      adminPasswordHash
    );
   

    if (!validEmail || !validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin email or password."
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        console.error("Admin session error:", error.message);

        return res.status(500).json({
          success: false,
          message: "Could not create admin session."
        });
      }

      req.session.admin = {
        email: adminEmail
      };

      req.session.save((saveError) => {
        if (saveError) {
          console.error("Admin session save error:", saveError.message);

          return res.status(500).json({
            success: false,
            message: "Could not save admin session."
          });
        }

        return res.json({
          success: true,
          message: "Admin login successful.",
          admin: {
            email: adminEmail
          }
        });
      });
    });

  } catch (error) {
    console.error("Admin login error:", error.message);

    res.status(500).json({
      success: false,
      message: "Admin login failed."
    });
  }
});

app.get("/api/v1/admin/auth/me", (req, res) => {
  if (!req.session?.admin) {
    return res.status(401).json({
      success: false,
      message: "Admin not logged in."
    });
  }

  res.json({
    success: true,
    admin: req.session.admin
  });
});

app.post("/api/v1/admin/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Admin logout error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Could not log out."
      });
    }

    res.clearCookie("raastatoll.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax"
    });

    res.json({
      success: true,
      message: "Admin logged out successfully."
    });
  });
});


app.post("/api/v1/admin/customers", authenticateAdmin, async (req, res) => {
  try {
    const { client_name, daily_limit = 100 } = req.body;

    if (
      typeof client_name !== "string" ||
      !client_name.trim() ||
      client_name.trim().length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid client name is required (maximum 150 characters)."
      });
    }

    if (
      !Number.isSafeInteger(daily_limit) ||
      daily_limit < 1
    ) {
      return res.status(400).json({
        success: false,
        message: "Daily limit must be a positive integer."
      });
    }

    // Generate a unique API key
    const apiKey = crypto.randomBytes(32).toString("hex");

    // Store only its SHA-256 hash
    const apiKeyHash = crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const result = await pool.query(
      `INSERT INTO api_clients
       (client_name, api_key_hash, active, daily_limit)
       VALUES ($1, $2, TRUE, $3)
       RETURNING id, client_name, active, daily_limit`,
      [client_name.trim(), apiKeyHash, daily_limit]
    );

    res.status(201).json({
      success: true,
      message: "Customer registered successfully.",
      customer: result.rows[0],
      api_key: apiKey,
      warning: "Save this API key securely. It will not be displayed again."
    });

  } catch (error) {
    console.error("Customer registration error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not register customer."
    });
  }
});

app.get("/api/v1/admin/customers", authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         c.id,
         c.client_name,
         c.active,
         c.daily_limit,
         COALESCE(u.request_count, 0) AS requests_used,
         GREATEST(
           c.daily_limit - COALESCE(u.request_count, 0),
           0
         ) AS requests_remaining
       FROM api_clients c
       LEFT JOIN api_usage u
         ON c.id = u.client_id
         AND u.usage_date = CURRENT_DATE
       ORDER BY c.id ASC`
    );

    res.json({
      success: true,
      total_customers: result.rowCount,
      customers: result.rows
    });

  } catch (error) {
    console.error("Customer listing error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not retrieve customers."
    });
  }
});


app.patch("/api/v1/admin/customers/:id/status", authenticateAdmin, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const { active } = req.body;

    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID."
      });
    }

    if (typeof active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Active must be true or false."
      });
    }

    const result = await pool.query(
      `UPDATE api_clients
       SET active = $1
       WHERE id = $2
       RETURNING id, client_name, active, daily_limit`,
      [active, customerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found."
      });
    }

    res.json({
      success: true,
      message: active
        ? "Customer activated successfully."
        : "Customer deactivated successfully.",
      customer: result.rows[0]
    });

  } catch (error) {
    console.error("Customer status update error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not update customer status."
    });
  }
});


app.patch("/api/v1/admin/customers/:id/limit", authenticateAdmin, async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const { daily_limit } = req.body;

    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID."
      });
    }

    if (!Number.isSafeInteger(daily_limit) || daily_limit < 1) {
      return res.status(400).json({
        success: false,
        message: "Daily limit must be a positive integer."
      });
    }

    const result = await pool.query(
      `UPDATE api_clients
       SET daily_limit = $1
       WHERE id = $2
       RETURNING id, client_name, active, daily_limit`,
      [daily_limit, customerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found."
      });
    }

    res.json({
      success: true,
      message: "Customer daily limit updated successfully.",
      customer: result.rows[0]
    });

  } catch (error) {
    console.error("Customer limit update error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not update customer limit."
    });
  }
});

app.get("/api/v1/admin/customers/:id/usage", authenticateAdmin, async (req, res) => {
  try {
    const customerId = Number(req.params.id);

    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID."
      });
    }

    const customerResult = await pool.query(
      `SELECT id, client_name, active, daily_limit
       FROM api_clients
       WHERE id = $1`,
      [customerId]
    );

    if (customerResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found."
      });
    }

    const usageResult = await pool.query(
  `SELECT usage_date::text AS usage_date, request_count
   FROM api_usage
   WHERE client_id = $1
   ORDER BY usage_date DESC
   LIMIT 30`,
  [customerId]
);

const todayUsageResult = await pool.query(
  `SELECT COALESCE(
     (SELECT request_count
      FROM api_usage
      WHERE client_id = $1
        AND usage_date = CURRENT_DATE),
     0
   ) AS requests_used_today`,
  [customerId]
);

const customer = customerResult.rows[0];

const requestsUsed = Number(
  todayUsageResult.rows[0].requests_used_today
);

    res.json({
      success: true,
      customer: {
        ...customer,
        daily_limit: Number(customer.daily_limit),
        requests_used_today: requestsUsed,
        requests_remaining_today: Math.max(
          0,
          Number(customer.daily_limit) - requestsUsed
        )
      },
      usage_history: usageResult.rows
    });

  } catch (error) {
    console.error("Customer usage history error:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not retrieve customer usage."
    });
  }
});


app.get("/api/v1/usage", authenticateApiKey, (req, res) => {
  const dailyLimit = Number(req.apiClient.daily_limit);
  const requestsUsed = Number(req.apiUsage);

  res.json({
    success: true,
    client_name: req.apiClient.client_name,
    daily_limit: dailyLimit,
    requests_used: requestsUsed,
    requests_remaining: Math.max(0, dailyLimit - requestsUsed)
  });
});



const PLAZA_LIMIT = 200;
const PLAZA_RADIUS_METERS = 250;
const DUPLICATE_RADIUS_METERS = 300;
const DME_ENDPOINT_RADIUS_METERS = 100;

const VEHICLE_CATEGORIES = [
  "car",
  "lcv",
  "bus",
  "multiaxle",
  "axle_4_6",
  "axle_7_plus",
  "hcm",
];

const JOURNEY_TYPES = ["single", "return", "monthly", "commercial"];
const DME_JOURNEY_TYPES = ["single", "return", "monthly"];

const ORS_DIRECTIONS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions";

const TRUCK_PROFILE =
  process.env.ORS_TRUCK_PROFILE || "driving-hgv";

const routeCache = new Map();
const ROUTE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ROUTE_CACHE_ENTRIES = 500;

async function getRouteFeature(source, destination, routingProfile) {
  const cacheKey = JSON.stringify([
    routingProfile,
    source,
    destination,
  ]);

  const cached = routeCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    console.log("Route cache HIT:", routingProfile);
    return cached.feature;
  }

  if (cached) {
    routeCache.delete(cacheKey);
  }

  console.log("Route cache MISS:", routingProfile);

  const routeResponse = await axios.post(
    `${ORS_DIRECTIONS_URL}/${routingProfile}/geojson`,
    { coordinates: [source, destination] },
    {
      headers: {
        Authorization: process.env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const feature = routeResponse.data.features?.[0];

  if (!feature?.geometry?.coordinates?.length) {
    throw new Error(
      "No route geometry was returned by the routing provider."
    );
  }

  if (routeCache.size >= MAX_ROUTE_CACHE_ENTRIES) {
    const oldestKey = routeCache.keys().next().value;
    routeCache.delete(oldestKey);
  }

  routeCache.set(cacheKey, {
    feature,
    expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
  });

  return feature;
}

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function currentFinancialYearStart(today) {
  const [year, month] = today.split("-").map(Number);
  const financialYear = month >= 4 ? year : year - 1;

  return `${financialYear}-04-01`;
}

function isValidPoint(point) {
  if (!Array.isArray(point) || point.length !== 2) {
    return false;
  }

  const [longitude, latitude] = point;

  return (
    typeof longitude === "number" &&
    typeof latitude === "number" &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

// Generic plaza mapping remains unchanged.
// DME uses its own exact axle-specific mapping.
function getDmeVehicleCategory({
  vehicleCategory,
  vehicleType,
  axleCount,
}) {
  if (vehicleType === "truck") {
    if (axleCount === 2) return "truck_bus_2axle";
    if (axleCount === 3) return "commercial_3axle";
    if (axleCount >= 4 && axleCount <= 6) return "axle_4_6";
    if (axleCount >= 7) return "axle_7_plus";
    return null;
  }

  if (vehicleType === "bus") {
    return axleCount === 2 ? "truck_bus_2axle" : null;
  }

  if (vehicleCategory === "car" || vehicleCategory === "lcv") {
    return vehicleCategory;
  }

  return null;
}

app.get("/api/v1/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "India Toll API is running",
      database: "connected",
    });
  } catch (error) {
    console.error("Health check database failure:", error.message);

    res.status(503).json({
      success: false,
      message: "API is running but database is unavailable",
      database: "disconnected",
    });
  }
});

app.get("/api/v1/toll-plazas", authenticateApiKey, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      100
    );

    const result = await pool.query(
      `SELECT source_id, name, highway, state,
              latitude, longitude, is_active
       FROM toll_plazas
       WHERE is_active = TRUE
       ORDER BY name
       LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error("Failed to fetch toll plazas:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to fetch toll plazas",
    });
  }
});

app.post("/api/v1/route", authenticateApiKey, async (req, res) => {
  try {
    const {
      source,
      destination,
      vehicle_category = "car",
      vehicle_type,
      axle_count,
      journey_type = "single",
      include_geometry = false,
    } = req.body || {};

    const isAxleBasedVehicle =
      vehicle_type === "truck" || vehicle_type === "bus";

    const isAxleBasedTruck = vehicle_type === "truck";
    const isAxleBasedBus = vehicle_type === "bus";

    let tariffCategory = vehicle_category;
    let isApproximate = false;

    if (
      vehicle_type !== undefined &&
      !["truck", "bus"].includes(vehicle_type)
    ) {
      return res.status(400).json({
        success: false,
        message: "vehicle_type supports only 'truck' or 'bus'.",
      });
    }

    if (isAxleBasedVehicle) {
      if (
        !Number.isInteger(axle_count) ||
        axle_count < 2 ||
        axle_count > 20
      ) {
        return res.status(400).json({
          success: false,
          message:
            `${vehicle_type} axle_count must be an integer between 2 and 20.`,
        });
      }

      if (isAxleBasedTruck) {
        tariffCategory =
          axle_count >= 7 ? "axle_7_plus" : "axle_4_6";

        isApproximate = axle_count <= 3;
      } else {
        // Bus is kept separate from truck for ordinary plaza rates.
        tariffCategory = "bus";
      }
    } else {
      if (axle_count !== undefined) {
        return res.status(400).json({
          success: false,
          message:
            "Provide vehicle_type: 'truck' or 'bus' when using axle_count.",
        });
      }

      if (!VEHICLE_CATEGORIES.includes(vehicle_category)) {
        return res.status(400).json({
          success: false,
          message: "Invalid vehicle category.",
          allowed_categories: VEHICLE_CATEGORIES,
        });
      }
    }

    if (!JOURNEY_TYPES.includes(journey_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid journey type.",
        allowed_journey_types: JOURNEY_TYPES,
      });
    }

    if (!isValidPoint(source) || !isValidPoint(destination)) {
      return res.status(400).json({
        success: false,
        message:
          "Source and destination must be [longitude, latitude] arrays of valid numbers.",
      });
    }

    if (!process.env.ORS_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Routing API key is not configured.",
      });
    }

    const routingProfile =
      isAxleBasedVehicle || vehicle_category !== "car"
        ? TRUCK_PROFILE
        : "driving-car";

    const feature = await getRouteFeature(
      source,
      destination,
      routingProfile
    );

    const routeGeometry = JSON.stringify(feature.geometry);

    const today = todayInIndia();
    const currentFyStart = currentFinancialYearStart(today);

    // ---------------------------------------------------------
    // 1. Find ordinary toll plazas intersecting the route.
    // ---------------------------------------------------------

    const plazaResult = await pool.query(
      `WITH route AS (
         SELECT ST_SetSRID(
           ST_GeomFromGeoJSON($1),
           4326
         ) AS geom
       )
       SELECT
         p.source_id,
         p.name,
         p.highway,
         p.state,
         p.latitude,
         p.longitude,
         ROUND(
           (
             ST_Distance(p.location, route.geom::geography) / 1000
           )::numeric,
           3
         ) AS distance_from_route_km,
         ROUND(
           (
             ST_LineLocatePoint(route.geom, p.location::geometry)
             * ST_Length(route.geom::geography) / 1000
           )::numeric,
           1
         ) AS approx_km_from_start,
         r.amount_inr AS rate_inr,
         r.effective_from AS rate_effective_from,
         r.effective_to AS rate_effective_to,
         p.data_source,
         p.data_confidence,
         p.rate_revision_date::text AS rate_revision_date,
         rc.total_rows,
         rc.category_rows,
         rc.category_other_journey_rows,
         rc.future_rows,
         rc.expired_rows,
         dup.source_id AS duplicate_source_id,
         dup.name AS duplicate_name,
         dup.data_source AS duplicate_data_source,
         dup.distance_m AS duplicate_distance_m
       FROM toll_plazas p
       CROSS JOIN route
       LEFT JOIN LATERAL (
         SELECT
           tr.amount_inr,
           tr.effective_from,
           tr.effective_to
         FROM toll_rates tr
         WHERE tr.plaza_id = p.id
           AND tr.vehicle_category = $2
           AND tr.rate_type = $4
           AND tr.effective_from <= CURRENT_DATE
           AND (
             tr.effective_to IS NULL
             OR tr.effective_to >= CURRENT_DATE
           )
         ORDER BY tr.effective_from DESC
         LIMIT 1
       ) r ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) AS total_rows,
           COUNT(*) FILTER (
             WHERE t.vehicle_category = $2
           ) AS category_rows,
           COUNT(*) FILTER (
             WHERE t.vehicle_category = $2
               AND t.rate_type <> $4
           ) AS category_other_journey_rows,
           COUNT(*) FILTER (
             WHERE t.vehicle_category = $2
               AND t.rate_type = $4
               AND t.effective_from > CURRENT_DATE
           ) AS future_rows,
           COUNT(*) FILTER (
             WHERE t.vehicle_category = $2
               AND t.rate_type = $4
               AND t.effective_to < CURRENT_DATE
           ) AS expired_rows
         FROM toll_rates t
         WHERE t.plaza_id = p.id
       ) rc ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           q.source_id,
           q.name,
           q.data_source,
           ROUND(ST_Distance(p.location, q.location)::numeric) AS distance_m
         FROM toll_plazas q
         WHERE q.is_active = TRUE
           AND q.id <> p.id
           AND ST_DWithin(p.location, q.location, $6)
         ORDER BY ST_Distance(p.location, q.location) ASC
         LIMIT 1
       ) dup ON TRUE
       WHERE p.is_active = TRUE
         AND ST_DWithin(
           p.location,
           route.geom::geography,
           $5
         )
       ORDER BY ST_Distance(p.location, route.geom::geography) ASC
       LIMIT $3`,
      [
        routeGeometry,
        tariffCategory,
        PLAZA_LIMIT,
        journey_type,
        PLAZA_RADIUS_METERS,
        DUPLICATE_RADIUS_METERS,
      ]
    );

    // ---------------------------------------------------------
    // 2. Find a permitted DME movement using route geometry.
    //
    // Both endpoints must be within 100 metres of the route.
    // Entry must occur before exit along the route.
    // The first eligible entry and last eligible exit are used.
    // ---------------------------------------------------------

    const dmeMovementResult = await pool.query(
      `WITH route AS (
         SELECT ST_SetSRID(
           ST_GeomFromGeoJSON($1),
           4326
         ) AS geom
       ),
       endpoint_positions AS (
         SELECT
           e.id AS endpoint_id,
           e.endpoint_code,
           e.endpoint_name,
           e.chainage_km,
           p.id AS plaza_id,
           ST_Distance(
             p.location,
             route.geom::geography
           ) AS distance_m,
           ST_LineLocatePoint(
             route.geom,
             p.location::geometry
           ) AS route_fraction,
           (
             ST_LineLocatePoint(
               route.geom,
               p.location::geometry
             ) * ST_Length(route.geom::geography) / 1000
           ) AS route_position_km
         FROM dme_endpoints e
         JOIN toll_plazas p
           ON p.id = e.plaza_id
         CROSS JOIN route
         WHERE p.is_active = TRUE
           AND ST_DWithin(
             p.location,
             route.geom::geography,
             $2
           )
       )
       SELECT
         m.id AS movement_id,
         m.direction,
         m.source_name,
         m.source_url,

         entry.endpoint_code AS entry_code,
         entry.endpoint_name AS entry_name,
         entry.chainage_km AS entry_chainage_km,
         entry.distance_m AS entry_distance_m,
         entry.route_position_km AS entry_route_position_km,

         exit.endpoint_code AS exit_code,
         exit.endpoint_name AS exit_name,
         exit.chainage_km AS exit_chainage_km,
         exit.distance_m AS exit_distance_m,
         exit.route_position_km AS exit_route_position_km

       FROM dme_permitted_movements m

       JOIN endpoint_positions entry
         ON entry.endpoint_id = m.entry_endpoint_id

       JOIN endpoint_positions exit
         ON exit.endpoint_id = m.exit_endpoint_id

       WHERE entry.route_fraction < exit.route_fraction

       ORDER BY
         entry.route_fraction ASC,
         exit.route_fraction DESC

       LIMIT 1`,
      [routeGeometry, DME_ENDPOINT_RADIUS_METERS]
    );

    const dmeMatchedMovement =
      dmeMovementResult.rows[0] || null;

    // ---------------------------------------------------------
    // 3. Map the requested vehicle to a DME category.
    // ---------------------------------------------------------

   const dmeVehicleCategory = getDmeVehicleCategory({
  vehicleCategory: tariffCategory,
  vehicleType: vehicle_type,
  axleCount: axle_count,
});

    const dmeJourneySupported =
      DME_JOURNEY_TYPES.includes(journey_type);

    // ---------------------------------------------------------
    // 4. Retrieve only the current financial year's DME fare.
    //
    // This deliberately excludes FY 2025-26 records even
    // though their effective_to is NULL.
    // ---------------------------------------------------------

    let dmeTariff = null;

    if (
      dmeMatchedMovement &&
      dmeVehicleCategory &&
      dmeJourneySupported
    ) {
      const dmeTariffResult = await pool.query(
        `SELECT
           amount_inr,
          effective_from::text AS effective_from,
          effective_to::text AS effective_to,
           source_name,
           source_url,
           verification_status
         FROM dme_route_tariffs
         WHERE movement_id = $1
           AND vehicle_category = $2
           AND journey_type = $3
           AND effective_from = $4::date
           AND (
             effective_to IS NULL
             OR effective_to >= $5::date
           )
         ORDER BY effective_from DESC
         LIMIT 1`,
        [
          dmeMatchedMovement.movement_id,
          dmeVehicleCategory,
          journey_type,
          currentFyStart,
          today,
        ]
      );

      dmeTariff = dmeTariffResult.rows[0] || null;
    }

    // ---------------------------------------------------------
    // 5. NH-54 schedule matching remains separate.
    // ---------------------------------------------------------

    const nh54TariffTypeMap = {
      single: "single",
      return: "return",
      monthly: "monthly_50_trips",
      commercial: "district_registered_commercial",
    };

    const nh54TariffType = nh54TariffTypeMap[journey_type];

    const nh54SectionResult = await pool.query(
      `SELECT
          s.id AS section_id,
          s.annexure,
          s.road_name,
          entry.endpoint_name AS entry_name,
          entry.endpoint_type AS entry_type,
          entry.chainage_km AS entry_chainage_km,
          exit.endpoint_name AS exit_name,
          exit.endpoint_type AS exit_type,
          exit.chainage_km AS exit_chainage_km,
          r.amount_inr,
          s.effective_from,
          s.effective_to,
          r.tariff_type
       FROM nhai_schedule_sections s
       JOIN nhai_schedule_endpoints entry
         ON entry.id = s.entry_endpoint_id
       JOIN nhai_schedule_endpoints exit
         ON exit.id = s.exit_endpoint_id
       LEFT JOIN nhai_schedule_rates r
         ON r.section_id = s.id
        AND r.vehicle_category = $1
        AND r.tariff_type = $2
       WHERE s.road_name ILIKE '%NH-54%'
         AND s.effective_from <= CURRENT_DATE
         AND s.effective_to >= CURRENT_DATE
       ORDER BY s.id`,
      [tariffCategory, nh54TariffType]
    );

    // ---------------------------------------------------------
    // 6. Build the ordinary toll-plaza response.
    // ---------------------------------------------------------

    const tollPlazas = plazaResult.rows
      .map((row) => {
        const rate =
          row.rate_inr === null ? null : Number(row.rate_inr);

        let rateStatus = "available";

        if (rate === null) {
          rateStatus = "missing";
        } else if (rate === 0) {
          rateStatus = "zero_in_source";
        }

        const rateDescription = describeRate({
          rateStatus,
          name: row.name,
          counts: row,
        });

        return {
          source_id: row.source_id,
          name: row.name,
          highway: row.highway,
          state: row.state,
          latitude: row.latitude,
          longitude: row.longitude,
          approx_km_from_start: Number(row.approx_km_from_start),
          distance_from_route_km: Number(row.distance_from_route_km),
          toll_inr: rateStatus === "available" ? rate : null,
          rate_status: rateStatus,
          likely_closed_system: CLOSED_SYSTEM_PATTERN.test(row.name || ""),
          fee_point_type: rateDescription.fee_point_type,
          missing_reason: rateDescription.missing_reason,
          rate_data_state: rateDescription.rate_data_state,
          possible_duplicate_of:
            row.duplicate_source_id === null ||
            row.duplicate_source_id === undefined
              ? null
              : {
                  source_id: row.duplicate_source_id,
                  name: row.duplicate_name,
                  data_source: row.duplicate_data_source,
                  distance_m: Number(row.duplicate_distance_m),
                },
          rate_effective_from: row.rate_effective_from,
          rate_effective_to: row.rate_effective_to,
          data_source: row.data_source,
          data_confidence: row.data_confidence,
          rate_revision_date: row.rate_revision_date,
        };
      })
      .sort(
        (a, b) =>
          a.approx_km_from_start - b.approx_km_from_start
      );

    for (const plaza of tollPlazas) {
      if (!plaza.rate_revision_date) {
        plaza.rate_freshness = "unknown";
      } else if (plaza.rate_revision_date >= today) {
        plaza.rate_freshness = "current";
      } else {
        plaza.rate_freshness = "past_revision_date";
      }
    }

    // ---------------------------------------------------------
    // 7. Match NH-54 exactly as before.
    // ---------------------------------------------------------

    const nh54MatchedSection =
      nh54SectionResult.rows.find((section) => {
        if (
          section.entry_type !== "toll_plaza" ||
          section.exit_type !== "toll_plaza"
        ) {
          return false;
        }

        const entryPlaza = tollPlazas.find(
          (p) =>
            p.name?.trim().toLowerCase() ===
            section.entry_name?.trim().toLowerCase()
        );

        const exitPlaza = tollPlazas.find(
          (p) =>
            p.name?.trim().toLowerCase() ===
              section.exit_name?.trim().toLowerCase() ||
            p.name?.trim().toLowerCase().startsWith(
              section.exit_name?.trim().toLowerCase() + " "
            )
        );

        return (
          entryPlaza &&
          exitPlaza &&
          entryPlaza.highway === "NH 54" &&
          exitPlaza.highway === "NH 54" &&
          entryPlaza.approx_km_from_start <
            exitPlaza.approx_km_from_start
        );
      }) || null;

    console.log(
      "NH54 MATCHED SECTION:",
      nh54MatchedSection
        ? {
            annexure: nh54MatchedSection.annexure,
            entry: nh54MatchedSection.entry_name,
            exit: nh54MatchedSection.exit_name,
            amount: nh54MatchedSection.amount_inr,
          }
        : null
    );

    console.log(
      "DME MATCHED MOVEMENT:",
      dmeMatchedMovement
        ? {
            movement_id: dmeMatchedMovement.movement_id,
            direction: dmeMatchedMovement.direction,
            entry: dmeMatchedMovement.entry_name,
            exit: dmeMatchedMovement.exit_name,
            entry_distance_m: Number(
              dmeMatchedMovement.entry_distance_m
            ),
            exit_distance_m: Number(
              dmeMatchedMovement.exit_distance_m
            ),
            category: dmeVehicleCategory,
            journey_type: journey_type,
            amount: dmeTariff
              ? Number(dmeTariff.amount_inr)
              : null,
          }
        : null
    );

    // ---------------------------------------------------------
    // 8. Determine which route-level toll system applies.
    //
    // DME takes precedence if matched.
    // NH-54 remains unchanged otherwise.
    // Ordinary plaza calculation is used only if neither
    // route-level system matches.
    // ---------------------------------------------------------

    const isDmeRouteMatched = Boolean(dmeMatchedMovement);
    const isNh54RouteMatched =
      !isDmeRouteMatched && Boolean(nh54MatchedSection);

    const dmeRateAvailable =
      isDmeRouteMatched && dmeTariff !== null;

    const nh54RateAvailable =
      isNh54RouteMatched &&
      nh54MatchedSection.amount_inr !== null &&
      nh54MatchedSection.amount_inr !== undefined;

    const withRate = tollPlazas.filter(
      (p) => p.rate_status === "available"
    );

    const closedSystemCount = tollPlazas.filter(
      (p) => p.likely_closed_system
    ).length;

    const possibleClosedSystemCount = tollPlazas.filter(
      (p) =>
        p.fee_point_type === "possible_closed_system" &&
        p.rate_status !== "available"
    ).length;

    const nonHighwayCount = tollPlazas.filter(
      (p) =>
        p.fee_point_type === "non_highway_fee_point" &&
        p.rate_status !== "available"
    ).length;

    const possibleDuplicateCount = tollPlazas.filter(
      (p) => p.possible_duplicate_of !== null
    ).length;

    const missingReasonCounts = {};

    for (const plaza of tollPlazas) {
      if (plaza.missing_reason) {
        missingReasonCounts[plaza.missing_reason] =
          (missingReasonCounts[plaza.missing_reason] || 0) + 1;
      }
    }

    const truncated = plazaResult.rowCount >= PLAZA_LIMIT;

    const pastRevisionCount = tollPlazas.filter(
      (p) => p.rate_freshness === "past_revision_date"
    ).length;

    const knownSubtotal = withRate.reduce(
      (sum, p) => sum + p.toll_inr,
      0
    );

    let complete;
    let calculatedTollTotal;

    if (isDmeRouteMatched) {
      complete = dmeRateAvailable;

      calculatedTollTotal = dmeRateAvailable
        ? Number(dmeTariff.amount_inr)
        : null;
    } else if (isNh54RouteMatched) {
      complete = nh54RateAvailable && !truncated;

      calculatedTollTotal = complete
        ? Number(nh54MatchedSection.amount_inr)
        : null;
    } else {
      complete =
        withRate.length === tollPlazas.length && !truncated;

      calculatedTollTotal = complete
        ? knownSubtotal
        : null;
    }

    // ---------------------------------------------------------
    // 9. Confidence and data-source metadata.
    // ---------------------------------------------------------

    let rateConfidence = "high";

    if (isDmeRouteMatched) {
      if (!dmeRateAvailable) {
        rateConfidence = "none";
      } else if (
        dmeTariff.verification_status === "verified"
      ) {
        rateConfidence = "high";
      } else {
        rateConfidence = "low";
      }
    } else if (isNh54RouteMatched && nh54RateAvailable) {
      rateConfidence = "high";
    } else if (withRate.length === 0) {
      rateConfidence = "none";
    } else if (
      withRate.some(
        (p) =>
          p.data_source !== "nhai" ||
          p.rate_freshness === "unknown"
      )
    ) {
      rateConfidence = "low";
    } else if (
      withRate.some(
        (p) => p.rate_freshness === "past_revision_date"
      )
    ) {
      rateConfidence = "medium";
    }

    const dataSources = [
      ...new Set(withRate.map((p) => p.data_source)),
    ];

    if (isDmeRouteMatched && dmeRateAvailable) {
      if (dmeTariff.source_name) {
        dataSources.push(dmeTariff.source_name);
      }
    }

    if (isNh54RouteMatched && nh54RateAvailable) {
      dataSources.push("NHAI NH-54 section schedule");
    }

    // ---------------------------------------------------------
    // 10. Warnings.
    // ---------------------------------------------------------

    const warnings = [];
    if (
  isDmeRouteMatched &&
  dmeRateAvailable &&
  dmeTariff.verification_status === "reported"
) {
  warnings.push(
    "The DME tariff is reported by a secondary source and has not been independently verified against an official NHAI tariff notification."
  );
}

    if (
      isAxleBasedTruck &&
      isApproximate &&
      !isDmeRouteMatched
    ) {
      warnings.push(
        `The requested ${axle_count}-axle truck does not have an exact axle-specific generic plaza tariff. The estimate uses the ${
          tariffCategory === "axle_4_6" ? "4–6 axle" : "7+ axle"
        } tariff band and should be independently verified.`
      );
    }

    if (truncated) {
      warnings.push(
        `${PLAZA_LIMIT} plazas were returned and more may exist; the list is cut off.`
      );
    }

    if (
      !isDmeRouteMatched &&
      !isNh54RouteMatched &&
      withRate.length < tollPlazas.length
    ) {
      warnings.push(
        "Some plazas have no usable rate, so no total is given. A rate of 0 in the source is not treated as free."
      );
    }

    if (isDmeRouteMatched && !dmeRateAvailable) {
      if (!dmeVehicleCategory) {
        warnings.push(
          "The DME movement was matched, but this vehicle configuration has no exact supported DME tariff category. No plaza-rate fallback was applied."
        );
      } else if (!dmeJourneySupported) {
        warnings.push(
          "The DME movement was matched, but this journey type is not supported by the DME tariff schedule. No plaza-rate fallback was applied."
        );
      } else {
        warnings.push(
          `The DME movement was matched, but no FY ${currentFyStart.slice(0, 4)} tariff exists for ${dmeVehicleCategory} / ${journey_type}. Historical tariff records were not reused, and no plaza-rate fallback was applied.`
        );
      }
    }

    if (isNh54RouteMatched && !nh54RateAvailable) {
      warnings.push(
        "The NH-54 section was matched, but no usable section fare exists for this vehicle category and journey type. No plaza-rate fallback was applied."
      );
    }

    if (
      closedSystemCount > 0 &&
      !isDmeRouteMatched
    ) {
      warnings.push(
        "Some plazas look like closed-system tolls (entry/exit based). Their fee depends on the entry and exit points and is not in the per-plaza rates."
      );
    }

    if (possibleClosedSystemCount > 0) {
      warnings.push(
        `${possibleClosedSystemCount} plaza(s) without a rate have interchange or exit style names and may be closed-system tolls. This is based on the name only and should be verified.`
      );
    }

    if (nonHighwayCount > 0) {
      warnings.push(
        `${nonHighwayCount} point(s) without a rate look like checkposts or border/forest fee points rather than highway toll plazas. They are not treated as free.`
      );
    }

    if (possibleDuplicateCount > 0) {
      warnings.push(
        `${possibleDuplicateCount} plaza(s) are within ${DUPLICATE_RADIUS_METERS} m of another listed plaza and may be the same physical toll point recorded twice. Totals are not adjusted.`
      );
    }

    if (
      pastRevisionCount > 0 &&
      !isNh54RouteMatched &&
      !isDmeRouteMatched
    ) {
      warnings.push(
        `${pastRevisionCount} plaza(s) have a rate whose revision date has passed; the published rate may have changed.`
      );
    }

    if (journey_type === "return") {
      warnings.push(
        "Return fees are the published return-journey fee. They are distinct from the reverse-direction single fare."
      );
    }

    // ---------------------------------------------------------
    // 11. Construct the route_toll object.
    // ---------------------------------------------------------

    let routeToll = null;

    if (isDmeRouteMatched) {
      routeToll = {
        matched: true,
        system: "Delhi-Meerut Expressway",
        movement_id: dmeMatchedMovement.movement_id,
        direction: dmeMatchedMovement.direction,

        entry: dmeMatchedMovement.entry_name,
        exit: dmeMatchedMovement.exit_name,

        entry_endpoint_code: dmeMatchedMovement.entry_code,
        exit_endpoint_code: dmeMatchedMovement.exit_code,

        entry_distance_from_route_m: Number(
          dmeMatchedMovement.entry_distance_m
        ),
        exit_distance_from_route_m: Number(
          dmeMatchedMovement.exit_distance_m
        ),

        vehicle_category: dmeVehicleCategory,
        requested_vehicle_type: vehicle_type || null,
        requested_axle_count: axle_count ?? null,
        journey_type,

        amount_inr: dmeRateAvailable
          ? Number(dmeTariff.amount_inr)
          : null,

        effective_from: dmeTariff?.effective_from || currentFyStart,
        effective_to: dmeTariff?.effective_to || null,

        source: dmeTariff?.source_name || null,
        source_url: dmeTariff?.source_url || null,
        verification_status:
          dmeTariff?.verification_status || "missing",

        financial_year_start: currentFyStart,
      };
    } else if (isNh54RouteMatched) {
      routeToll = {
        matched: true,
        system: "NH-54",
        road_name: nh54MatchedSection.road_name,
        annexure: nh54MatchedSection.annexure,
        entry: nh54MatchedSection.entry_name,
        exit: nh54MatchedSection.exit_name,
        vehicle_category: tariffCategory,
        journey_type,
        tariff_type: nh54TariffType,
        amount_inr: complete
          ? Number(nh54MatchedSection.amount_inr)
          : null,
        effective_from: nh54MatchedSection.effective_from,
        effective_to: nh54MatchedSection.effective_to,
        source: "NHAI User Fee Rates (2026-27) - NH-54",
      };
    }

    // ---------------------------------------------------------
    // 12. Final response.
    // ---------------------------------------------------------

    const data = {
      vehicle_type: vehicle_type || undefined,

      requested_axle_count: isAxleBasedVehicle
        ? axle_count
        : undefined,

      vehicle_category: tariffCategory,
      tariff_category_used: tariffCategory,

      is_approximate:
        isDmeRouteMatched
          ? false
          : isAxleBasedTruck
            ? isApproximate
            : false,

      estimation_message: isDmeRouteMatched
        ? null
        : isAxleBasedTruck
          ? isApproximate
            ? `Exact ${axle_count}-axle generic plaza tariff is not available. The estimate uses the available ${
                tariffCategory === "axle_4_6" ? "4–6 axle" : "7+ axle"
              } tariff band.`
            : `The estimate uses the ${
                tariffCategory === "axle_4_6" ? "4–6 axle" : "7+ axle"
              } tariff band.`
          : null,

      journey_type,
      routing_profile: routingProfile,

      distance_meters: feature.properties.summary.distance,
      duration_seconds: feature.properties.summary.duration,

      toll_plaza_candidates: plazaResult.rowCount,

      route_toll: routeToll,

      toll_summary: {
        total_toll_inr: calculatedTollTotal,

        // Informational sum of individual plaza records.
        // It is not a DME or NH-54 route-level fare.
        known_subtotal_inr: knownSubtotal,

        plazas_with_rate: withRate.length,
        plazas_without_rate: tollPlazas.length - withRate.length,

        likely_closed_system_plazas: closedSystemCount,
        plazas_past_revision_date: pastRevisionCount,

        missing_reason_counts: missingReasonCounts,
        rate_confidence: rateConfidence,
        data_sources: dataSources,

        list_may_be_truncated: truncated,
        warnings,
      },

      toll_plazas: tollPlazas,
    };

    if (include_geometry === true) {
      data.route_geometry = feature.geometry;
    }

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    const upstreamStatus = error.response?.status || null;

    const isDatabaseError =
      /^[0-9A-Z]{5}$/.test(error.code || "") ||
      ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(
        error.code
      );

    if (axios.isAxiosError(error)) {
      const isTimeout =
        error.code === "ECONNABORTED" ||
        error.code === "ETIMEDOUT";

      console.error("Routing provider failure:", {
        message: error.message,
        status: upstreamStatus,
        response: error.response?.data,
      });

      return res.status(isTimeout ? 504 : 502).json({
        success: false,
        message: isTimeout
          ? "The routing provider timed out. Please try again."
          : "Unable to obtain route from the routing provider.",
        upstream_status: upstreamStatus,
      });
    }

    if (isDatabaseError) {
      console.error(
        "Database failure during route request:",
        error.message
      );

      return res.status(503).json({
        success: false,
        message: "Toll database is temporarily unavailable.",
      });
    }

    console.error(
      "Unexpected route request failure:",
      error.stack || error.message
    );

    return res.status(500).json({
      success: false,
      message: "An internal error occurred while calculating the route.",
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



