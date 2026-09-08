const express = require('express');
const { Client: PGClient } = require('pg');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pgConfig = {
  host: 'arl-community-developer.postgres.database.azure.com',
  port: 5432,
  database: 'ArlOpexDB',
  user: 'deputy.coo@akijresource.com',
  password: 'RalTn76abw!379',
  ssl: { rejectUnauthorized: false }
};

const dwhConfig = {
  server: '203.202.241.211',
  port: 1433,
  database: 'DWH',
  user: 'mcp_user',
  password: 'iAOS@35o997',
  options: { encrypt: false, trustServerCertificate: true }
};

let dwhPool = null;
async function getDwhPool() {
  if (!dwhPool) dwhPool = await sql.connect(dwhConfig);
  return dwhPool;
}

// Helper: try filtered query, fallback to all SBU data if empty or zero
async function pgQueryWithFallback(client, baseQuery, filteredQuery, params, fallbackParams, countKey) {
  try {
    const r = await client.query(filteredQuery, params);
    if (r.rows.length > 0) {
      if (countKey && r.rows[0][countKey] !== undefined && parseInt(r.rows[0][countKey]) === 0) {
        // Count is 0, fallback
      } else {
        return { rows: r.rows, filtered: true };
      }
    }
  } catch (e) { /* ignore, will fallback */ }
  const r2 = await client.query(baseQuery, fallbackParams || [params[0]]);
  return { rows: r2.rows, filtered: false };
}

// Helper: try HRML first, if empty try MRML (MRML = HRML)
async function pgQueryWithMRMLFallback(client, baseQuery, filteredQuery, params, fallbackParams, countKey) {
  // Try original SBU first
  const result = await pgQueryWithFallback(client, baseQuery, filteredQuery, params, fallbackParams, countKey);
  if (result.rows.length > 0) {
    // Check if count is > 0
    if (countKey) {
      const total = parseInt(result.rows[0][countKey]);
      if (total > 0) return { ...result, sbuUsed: params[0] };
    } else {
      return { ...result, sbuUsed: params[0] };
    }
  }
  // Fallback to MRML if original SBU has no data
  if (params[0] === 'HRML') {
    const mrmlParams = [...params]; mrmlParams[0] = 'MRML';
    const mrmlFallback = [...(fallbackParams || [params[0]])]; mrmlFallback[0] = 'MRML';
    const r2 = await pgQueryWithFallback(client, baseQuery, filteredQuery, mrmlParams, mrmlFallback, countKey);
    return { ...r2, sbuUsed: 'MRML' };
  }
  return { ...result, sbuUsed: params[0] };
}

// Helper: simple query with HRML→MRML fallback
async function pgSimpleWithMRMLFallback(client, query, sbu) {
  let r = await client.query(query, [sbu]);
  // Check if first row has a 'total' or 'count' key with value 0
  const row = r.rows[0] || {};
  const hasData = r.rows.length > 0 && !(row.total !== undefined && parseInt(row.total) === 0) && !(row.count !== undefined && parseInt(row.count) === 0);
  if (hasData && sbu === 'HRML') return { rows: r.rows, sbuUsed: sbu };
  if (sbu === 'HRML') {
    let r2 = await client.query(query, ['MRML']);
    const row2 = r2.rows[0] || {};
    const hasData2 = r2.rows.length > 0 && !(row2.total !== undefined && parseInt(row2.total) === 0) && !(row2.count !== undefined && parseInt(row2.count) === 0);
    if (hasData2) return { rows: r2.rows, sbuUsed: 'MRML' };
  }
  return { rows: r.rows, sbuUsed: sbu };
}

// ============ Aggregated Dashboard Endpoint ============
app.get('/api/dashboard', async (req, res) => {
  try {
    const sbu = req.query.sbu || 'HRML';
    const startDate = req.query.startDate || '2026-09-01';
    const endDate = req.query.endDate || '2026-09-07';
    const pgDateEnd = endDate + ' 23:59:59';

    const pg = new PGClient(pgConfig);
    await pg.connect();

    // ===== 1. 5S =====
    const fiveS = await pgQueryWithFallback(pg,
      `SELECT audit_place, ROUND(AVG(final_score_pct::numeric),1) as avg_score, COUNT(*) as total_audits
       FROM accl_5s_audit_entries WHERE sbu=$1 GROUP BY audit_place ORDER BY avg_score DESC`,
      `SELECT audit_place, ROUND(AVG(final_score_pct::numeric),1) as avg_score, COUNT(*) as total_audits
       FROM accl_5s_audit_entries WHERE sbu=$1 AND audit_timestamp>=$2 AND audit_timestamp<=$3
       GROUP BY audit_place ORDER BY avg_score DESC`,
      [sbu, startDate, pgDateEnd], [sbu]
    );
    const fiveSAvg = fiveS.rows.length > 0
      ? Math.round(fiveS.rows.reduce((s,r) => s + parseFloat(r.avg_score), 0) / fiveS.rows.length * 10) / 10 : 0;

    // ===== 2. QCP =====
    const qcp = await pgQueryWithFallback(pg,
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='Pass' THEN 1 END) as passed,
              COUNT(CASE WHEN status='Fail' THEN 1 END) as failed
       FROM qcp_audit WHERE sbu=$1`,
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='Pass' THEN 1 END) as passed,
              COUNT(CASE WHEN status='Fail' THEN 1 END) as failed
       FROM qcp_audit WHERE sbu=$1 AND audit_date>=$2 AND audit_date<=$3`,
      [sbu, startDate, endDate], [sbu], 'total'
    );
    const qcpRow = qcp.rows[0] || { total: 0, passed: 0, failed: 0 };
    const qcpCompliance = qcpRow.total > 0 ? Math.round(qcpRow.passed / qcpRow.total * 100 * 10) / 10 : 0;

    // ===== 3. Kaizen =====
    const kaizen = await pgQueryWithMRMLFallback(pg,
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN status='Implemented' OR status='Completed' THEN 1 END) as implemented
       FROM improvement_cards WHERE sbu=$1 AND (hidden='False' OR hidden='false')`,
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN status='Implemented' OR status='Completed' THEN 1 END) as implemented
       FROM improvement_cards WHERE sbu=$1 AND (hidden='False' OR hidden='false')
         AND created_date>=$2 AND created_date<=$3`,
      [sbu, startDate, pgDateEnd], [sbu], 'total'
    );

    // ===== 3b. Kaizen by dept =====
    const kaizenDept = await pgSimpleWithMRMLFallback(pg,
      `SELECT dept, COUNT(*) as count FROM improvement_cards
       WHERE sbu=$1 AND (hidden='False' OR hidden='false') GROUP BY dept ORDER BY count DESC LIMIT 5`, sbu
    );

    // ===== 4. Problem Solving =====
    const ps = await pgQueryWithMRMLFallback(pg,
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='Completed' THEN 1 END) as completed
       FROM problem_solving_cards WHERE sbu=$1 AND (hidden='False' OR hidden='false')`,
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='Completed' THEN 1 END) as completed
       FROM problem_solving_cards WHERE sbu=$1 AND (hidden='False' OR hidden='false')
         AND created_date>=$2 AND created_date<=$3`,
      [sbu, startDate, pgDateEnd], [sbu], 'total'
    );

    // ===== 5. Standardization =====
    const std = await pgSimpleWithMRMLFallback(pg,
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status='Completed' THEN 1 END) as completed
       FROM process_standardization WHERE sbu=$1`, sbu
    );

    // ===== 6. Projects =====
    const proj = await pg.query(`
      SELECT project_name, status, progress FROM projects WHERE sbu=$1
    `, [sbu]);

    // ===== 7. Cost Savings =====
    const savings = await pg.query(`
      SELECT section, SUM(total_savings_bdt::numeric) as total
      FROM cost_savings WHERE sbu=$1 AND (hidden='False' OR hidden='false') GROUP BY section
    `, [sbu]);
    const totalSavings = savings.rows.reduce((s,r) => s + parseFloat(r.total || 0), 0);

    // ===== 8. Daily Meeting =====
    const meeting = await pgQueryWithFallback(pg,
      `SELECT COUNT(*) as total FROM daily_meeting_form WHERE sbu=$1`,
      `SELECT COUNT(*) as total FROM daily_meeting_form WHERE sbu=$1 AND meeting_date>=$2 AND meeting_date<=$3`,
      [sbu, startDate, endDate], [sbu], 'total'
    );

    await pg.end();

    // ===== 9. DWH OEE Data =====
    let oeeData = { by_machine: [], daily_trend: [], npt_by_type: [], summary: {} };
    try {
      await getDwhPool();

      const dwhFilter = `AND dteProductionDate >= @dStart AND dteProductionDate <= @dEnd`;

      // OEE by Machine
      const oeeByMachine = await new sql.Request()
        .input('dStart', sql.Date, startDate)
        .input('dEnd', sql.Date, endDate)
        .query(`
          SELECT strShopFloorName as shopfloor, strMachineName as machine,
            SUM(numShiftTargetQuantity) as total_target,
            SUM(numActualOutputQuantity) as total_actual,
            SUM(numGoodOutputQuantity) as total_good,
            SUM(numNptLossTimeInMinutes) as total_npt_min,
            SUM(numPlannedDowntimeMin) as total_planned_dt_min,
            SUM(numShiftDurationMinute) as total_shift_min,
            CASE WHEN SUM(numShiftTargetQuantity)>0 THEN ROUND(SUM(numGoodOutputQuantity)*100.0/SUM(numShiftTargetQuantity),1) ELSE 0 END as oee_pct
          FROM mes.tblOeeProdWasteHeaderArc
          WHERE intBusinessUnitId=188 ${dwhFilter}
          GROUP BY strShopFloorName, strMachineName ORDER BY oee_pct DESC
        `);

      // Daily OEE Trend
      const oeeDaily = await new sql.Request()
        .input('dStart', sql.Date, startDate)
        .input('dEnd', sql.Date, endDate)
        .query(`
          SELECT TOP 31 dteProductionDate as prod_date,
            SUM(numShiftTargetQuantity) as daily_target,
            SUM(numActualOutputQuantity) as daily_actual,
            SUM(numGoodOutputQuantity) as daily_good,
            SUM(numNptLossTimeInMinutes) as daily_npt_min,
            CASE WHEN SUM(numShiftTargetQuantity)>0 THEN ROUND(SUM(numGoodOutputQuantity)*100.0/SUM(numShiftTargetQuantity),1) ELSE 0 END as daily_oee_pct
          FROM mes.tblOeeProdWasteHeaderArc
          WHERE intBusinessUnitId=188 ${dwhFilter}
          GROUP BY dteProductionDate ORDER BY dteProductionDate DESC
        `);

      // NPT by Type
      const nptByType = await new sql.Request()
        .input('dStart', sql.Date, startDate)
        .input('dEnd', sql.Date, endDate)
        .query(`
          SELECT TOP 8
            CASE
              WHEN strDownTimeReason LIKE '%Mechanical%' OR strDownTimeReason LIKE '%Breakdown%' OR strDownTimeReason LIKE '%Motor%' THEN 'Mechanical Breakdown'
              WHEN strDownTimeReason LIKE '%Electrical%' OR strDownTimeReason LIKE '%Power%' THEN 'Electrical Breakdown'
              WHEN strDownTimeReason LIKE '%Utility%' OR strDownTimeReason LIKE '%Electricity%' OR strDownTimeReason LIKE '%Voltage%' THEN 'Utility (Electricity)'
              WHEN strDownTimeReason LIKE '%Setup%' OR strDownTimeReason LIKE '%Adjustment%' OR strDownTimeReason LIKE '%Changeover%' THEN 'Setup / Adjustment'
              WHEN strDownTimeReason LIKE '%Warehouse%' OR strDownTimeReason LIKE '%Block%' OR strDownTimeReason LIKE '%Store%' THEN 'Warehouse Block'
              WHEN strDownTimeReason LIKE '%Cleaning%' OR strDownTimeReason LIKE '%P01%' THEN 'Cleaning / Maintenance'
              WHEN strDownTimeReason LIKE '%Rice empty%' OR strDownTimeReason LIKE '%Peak%' THEN 'Material Unavailability'
              ELSE 'Other'
            END as npt_type,
            SUM(numNptLossTimeInMinutes + numPlannedDowntimeMin) as total_min,
            COUNT(*) as occurrences
          FROM mes.tblOeeProdWasteHeaderArc
          WHERE intBusinessUnitId=188 AND (numNptLossTimeInMinutes>0 OR numPlannedDowntimeMin>0) ${dwhFilter}
          GROUP BY
            CASE
              WHEN strDownTimeReason LIKE '%Mechanical%' OR strDownTimeReason LIKE '%Breakdown%' OR strDownTimeReason LIKE '%Motor%' THEN 'Mechanical Breakdown'
              WHEN strDownTimeReason LIKE '%Electrical%' OR strDownTimeReason LIKE '%Power%' THEN 'Electrical Breakdown'
              WHEN strDownTimeReason LIKE '%Utility%' OR strDownTimeReason LIKE '%Electricity%' OR strDownTimeReason LIKE '%Voltage%' THEN 'Utility (Electricity)'
              WHEN strDownTimeReason LIKE '%Setup%' OR strDownTimeReason LIKE '%Adjustment%' OR strDownTimeReason LIKE '%Changeover%' THEN 'Setup / Adjustment'
              WHEN strDownTimeReason LIKE '%Warehouse%' OR strDownTimeReason LIKE '%Block%' OR strDownTimeReason LIKE '%Store%' THEN 'Warehouse Block'
              WHEN strDownTimeReason LIKE '%Cleaning%' OR strDownTimeReason LIKE '%P01%' THEN 'Cleaning / Maintenance'
              WHEN strDownTimeReason LIKE '%Rice empty%' OR strDownTimeReason LIKE '%Peak%' THEN 'Material Unavailability'
              ELSE 'Other'
            END
          ORDER BY total_min DESC
        `);

      // Production Summary
      const prodSummary = await new sql.Request()
        .input('dStart', sql.Date, startDate)
        .input('dEnd', sql.Date, endDate)
        .query(`
          SELECT
            SUM(numShiftTargetQuantity) as total_target,
            SUM(numActualOutputQuantity) as total_actual,
            SUM(numGoodOutputQuantity) as total_good,
            SUM(numNptLossTimeInMinutes) as total_npt_min,
            SUM(numPlannedDowntimeMin) as total_planned_dt_min,
            SUM(numShiftDurationMinute) as total_shift_min,
            CASE WHEN SUM(numShiftTargetQuantity)>0 THEN ROUND(SUM(numGoodOutputQuantity)*100.0/SUM(numShiftTargetQuantity),1) ELSE 0 END as overall_oee_pct
          FROM mes.tblOeeProdWasteHeaderArc
          WHERE intBusinessUnitId=188 ${dwhFilter}
        `);

      oeeData = {
        by_machine: oeeByMachine.recordset,
        daily_trend: oeeDaily.recordset,
        npt_by_type: nptByType.recordset,
        summary: prodSummary.recordset[0] || {}
      };
    } catch (e) {
      console.log('DWH Error:', e.message);
    }

    res.json({
      sbu, startDate, endDate,
      five_s: { overall: fiveSAvg, target: 85, areas: fiveS.rows, filtered: fiveS.filtered },
      qcp: { total: parseInt(qcpRow.total), passed: parseInt(qcpRow.passed), failed: parseInt(qcpRow.failed), compliance: qcpCompliance, filtered: qcp.filtered },
      kaizen: { total: parseInt(kaizen.rows[0].total), implemented: parseInt(kaizen.rows[0].implemented), by_dept: kaizenDept.rows, filtered: kaizen.filtered, sbuUsed: kaizen.sbuUsed || sbu },
      problem_solving: { total: parseInt(ps.rows[0].total), completed: parseInt(ps.rows[0].completed), filtered: ps.filtered, sbuUsed: ps.sbuUsed || sbu },
      standardization: { total: parseInt(std.rows[0].total), completed: parseInt(std.rows[0].completed), index: std.rows[0].total > 0 ? Math.round(std.rows[0].completed / std.rows[0].total * 100) : 0, sbuUsed: std.sbuUsed || sbu },
      projects: proj.rows,
      cost_savings: { total: Math.round(totalSavings), by_section: savings.rows },
      daily_meeting: { total: parseInt(meeting.rows[0].total || 0) },
      oee: oeeData
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`OPEX API running on http://localhost:${PORT}`);
  console.log(`GET /api/dashboard?sbu=HRML&startDate=2026-09-01&endDate=2026-09-07`);
});
