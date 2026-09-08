# HRML Operational Excellence Dashboard

Live production monitoring dashboard for **Hashem Rice Mills Ltd (HRML)** — part of Akij Resources.

## 🌐 Live Demo

**[View Live Dashboard](https://soaib-hossain.github.io/opex-dashboard/)** — Live data from MCP server

## 📊 Features

- **Live Data** — Fetches directly from MCP server (no local API needed)
- **OEE Analysis** — Availability × Performance × Quality
- **Production Tracking** — Actual vs Target by SBU
- **5S Audit Scores** — Area-wise audit tracking
- **Kaizen Tracker** — Ideas, implementation status
- **All SBU Comparison** — Side-by-side performance
- **Month Selector** — Choose any month
- **Auto Refresh** — 5-minute refresh cycle

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Data Source:** MCP Server (`akij-opex-kpi`) — Vercel hosted
- **No Backend Required** — Pure frontend, deploys to GitHub Pages

## 🚀 Deployment

### GitHub Pages (Live Demo)
1. Fork or clone this repo
2. Go to **Settings → Pages**
3. Source: **Deploy from branch** → **main** → **(root)**
4. Your dashboard is live at `https://yourusername.github.io/opex-dashboard/`

### Local (Full Version with DWH)
```bash
git clone https://github.com/soaib-hossain/opex-dashboard.git
cd opex-dashboard
npm install
node opex-api.js
# Open http://localhost:3001
```

## 📁 Project Structure

```
opex-dashboard/
├── index.html               # GitHub Pages (MCP live data)
├── OPEX_Live_Dashboard.html  # Full dashboard (local API + DWH)
├── opex-api.js              # Express API server (local use)
├── package.json             # Node.js dependencies
├── Start_OPEX_Dashboard.bat # Windows launcher
└── README.md
```

## 🔌 MCP Server

Data is fetched from: `https://vercel-liard-eight-31.vercel.app/api/mcp`

Available tools:
| Tool | Description |
|------|-------------|
| `get_kpi_summary` | MTD summary per SBU |
| `get_production` | Daily production by SBU |
| `get_5s` | 5S audit scores |
| `get_kaizen` | Kaizen counts |
| `get_targets` | Monthly targets |

## 👤 Author

**MD. Soaib Hossain** — Assistant Officer (Operational Excellence)
Hashem Rice Mills Ltd (HRML)

---

*Turning Losses into Opportunities, Data into Decisions, and Kaizen into Culture*
