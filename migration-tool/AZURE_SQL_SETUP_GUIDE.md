# Azure SQL Database Setup Guide (Forever Free Offer)

This guide provides step-by-step instructions to provision a **100% Free Azure SQL Database** using Azure's **Free Offer (Serverless Tier)** for use with the Daily Expense migration tool.

## 🛠️ Step-by-Step Provisioning Guide

### Step 1: Log in to Azure Portal
1. Open [portal.azure.com](https://portal.azure.com) in your browser and sign in with your Microsoft account.

---

### Step 2: Create a New SQL Database
1. In the top search bar, type **SQL databases** and select **SQL databases**.
2. Click **+ Create** (or **+ New**).

---

### Step 3: Configure Basic Settings
On the **Basics** tab, fill out the following fields:

1. **Subscription:** Select your active subscription (e.g., *Azure Subscription 1* or *Pay-As-You-Go*).
2. **Resource Group:** Click **Create new** $\rightarrow$ name it `rg-daily-expense` $\rightarrow$ click **OK**.
3. **Database name:** Enter `daily_expense_db`.
4. **Server:** Click **Create new**:
   * **Server name:** Enter a unique name (e.g., `sqlserver-dailyexpense-yourname`).
   * **Location:** Select a region close to you (e.g., *East US*, *West US 2*, or *Central India*).
   * **Authentication method:** Select **Use SQL authentication** (or *Use both Azure AD and SQL authentication*).
   * **Server admin login:** Choose a username (e.g., `azureadmin`).
   * **Password:** Enter a strong password (keep this safe for your `.env` file!).
   * Click **OK**.

---

### Step 4: Apply the Free Offer (Crucial Step!)

Look for the **Workload environment** / **Compute + storage** section on the Basics page:

1. Check the box: **"Apply free offer"** (or click **Configure database**).
2. Under **Service Tier**, ensure **General Purpose - Serverless** is selected.
3. Verify the following settings:
   * **Auto-pause delay:** Set to **1 hour** (automatically pauses when idle to preserve your free vCore seconds).
   * **Max vCore:** `0.5` or `1.0`.
   * **Storage:** `32 GB` (covered by the free tier).

> 💡 *Note: Azure allows 1 free Azure SQL Database offer per Azure subscription.*

---

### Step 5: Configure Networking & Firewall (Required for Client Connection)

Click the **Networking** tab at the top:

1. **Connectivity method:** Select **Public endpoint**.
2. **Allow Azure services and resources to access this server:** Select **Yes**.
3. **Add current client IP address:** Select **Yes** *(This adds your local computer's IP address to the Azure SQL Firewall so your migration script can connect)*.

---

### Step 6: Review & Create
1. Click **Review + create** at the bottom.
2. Verify that **Estimated cost** shows **$0.00 / Free offer applied**.
3. Click **Create**.
4. Deployment usually takes **1 to 3 minutes**. Once completed, click **Go to resource**.

---

## 📝 Updating Your `migration-tool/.env`

Once your database is created, open your `migration-tool/.env` file and fill in your connection credentials:

```env
SQLITE_DB_PATH=../backend/data/daily_expense.db

AZURE_SQL_SERVER=sqlserver-dailyexpense-yourname.database.windows.net
AZURE_SQL_DATABASE=daily_expense_db
AZURE_SQL_USER=azureadmin
AZURE_SQL_PASSWORD=YourPassword123!
AZURE_SQL_PORT=1433
AZURE_SQL_ENCRYPT=true
AZURE_SQL_TRUST_SERVER_CERTIFICATE=false
```

---

## 🏃 Testing & Executing Migration

Navigate to your `migration-tool` directory and run:

```bash
cd migration-tool
npm start
```

The script will automatically connect to your new free Azure SQL Database, create the schema, batch-migrate all your data from SQLite, and print out the audit verification report!
