import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb, DataType } from "pg-mem";

// Sin DATABASE_URL, las consultas reales deben fallar con mensaje claro.
describe("stats sin BD", () => {
  it("getRanking/getUserHistory exigen DATABASE_URL", async () => {
    if (process.env.DATABASE_URL) return; // con BD real lo cubre db.test.js
    const { getRanking, getUserHistory } = await import("../src/db/stats.js");
    await assert.rejects(getRanking(), /no configurada/);
    await assert.rejects(getUserHistory(1), /no configurada/);
  });
});

// Lógica SQL validada en memoria (vista compatible: pg-mem no soporta RANK() OVER).
describe("stats SQL (pg-mem)", () => {
  function seedDb() {
    const db = newDb();
    db.public.registerFunction({
      name: "char_length", args: [DataType.text], returns: DataType.integer,
      implementation: (x) => (x == null ? null : String(x).length),
    });
    let schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "database", "schema.sql"), "utf8");
    schema = schema.replace(
      /CREATE OR REPLACE VIEW v_ranking AS[\s\S]*?ORDER BY rank, u\.username;/,
      `CREATE OR REPLACE VIEW v_ranking AS SELECT u.id, u.username, u.is_guest,
        COALESCE(s.games_played,0) AS games_played, COALESCE(s.games_won,0) AS games_won,
        COALESCE(s.total_points,0) AS total_points, 1 AS rank FROM users u
        LEFT JOIN user_stats s ON s.user_id=u.id WHERE COALESCE(s.games_played,0)>0;`
    );
    db.public.none(schema);
    db.public.none(`INSERT INTO users (username,email,password_hash,is_guest) VALUES
      ('alba','a@x.co','h',FALSE), ('bruno','b@x.co','h',FALSE)`);
    const alba = db.public.one("SELECT id FROM users WHERE username='alba'").id;
    const bruno = db.public.one("SELECT id FROM users WHERE username='bruno'").id;
    db.public.none(`INSERT INTO user_stats VALUES (${alba},2,2,90,now()), (${bruno},2,0,10,now())`);
    return { db, alba, bruno };
  }

  it("ranking ordena por victorias y puntos", () => {
    const { db } = seedDb();
    const rows = db.public.many("SELECT * FROM v_ranking ORDER BY games_won DESC, total_points DESC LIMIT 50");
    assert.equal(rows[0].username, "alba");
    assert.equal(rows.length, 2);
  });

  it("historial filtra por usuario", () => {
    const { db, alba, bruno } = seedDb();
    db.public.none(`INSERT INTO games (mode, winner_id, winner_seat) VALUES ('solo', ${alba}, 0)`);
    const g = db.public.one("SELECT id FROM games LIMIT 1").id;
    db.public.none(`INSERT INTO game_players (game_id,user_id,seat,final_score,is_bot) VALUES (${g},${alba},0,30,FALSE), (${g},NULL,1,0,TRUE)`);
    const mine = db.public.many(`SELECT g.id FROM games g JOIN game_players gp ON gp.game_id=g.id AND gp.user_id=${alba}`);
    const other = db.public.many(`SELECT g.id FROM games g JOIN game_players gp ON gp.game_id=g.id AND gp.user_id=${bruno}`);
    assert.equal(mine.length, 1);
    assert.equal(other.length, 0);
  });
});
