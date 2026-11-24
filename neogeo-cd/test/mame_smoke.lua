-- MAME smoke test (CI): boot the disc, let the title fall into attract mode (CPU vs CPU),
-- snapshot every 10 s and print DATlib's frame counters (dropped frames = the 68000 ran late).
local frames = 0
local drop = tonumber(os.getenv("XM_DROP_ADDR") or "0") or 0
local count = tonumber(os.getenv("XM_FRAME_ADDR") or "0") or 0
local status = tonumber(os.getenv("XM_STATUS_ADDR") or "0") or 0
local prof = tonumber(os.getenv("XM_PROF_ADDR") or "0") or 0
local psum = tonumber(os.getenv("XM_PSUM_ADDR") or "0") or 0
local pn = tonumber(os.getenv("XM_PN_ADDR") or "0") or 0
local NAMES = { [0] = "brick", "calm", "climb", "jewel", "swap", "pop", "grab", "nom", "arsenal", "power" }
local last_d, last_c = 0, 0
local function tick()
  frames = frames + 1
  if frames % 300 == 0 then
    if frames % 600 == 0 then manager.machine.video:snapshot() end
    local cpu = manager.machine.devices[":maincpu"]
    if cpu and drop > 0 then
      local sp = cpu.spaces["program"]
      local d, c = sp:read_u32(drop), sp:read_u32(count)
      local st = status > 0 and sp:read_u16(status) or 0
      local what = (st >> 12) == 2 and (NAMES[st & 15] .. " vs " .. NAMES[(st >> 4) & 15]) or "menu"
      local p = ""
      if prof > 0 then
        p = string.format("  lines: side0 %d side1 %d draw %d sent %d", sp:read_u16(prof), sp:read_u16(prof + 2), sp:read_u16(prof + 4), sp:read_u16(prof + 6))
        for i = 0, 3 do sp:write_u16(prof + i * 2, 0) end
        if psum > 0 and pn > 0 then
          local a = {}
          for i = 0, 3 do
            local n = sp:read_u16(pn + i * 2)
            a[i + 1] = n > 0 and (sp:read_u32(psum + i * 4) // n) or 0
            sp:write_u32(psum + i * 4, 0); sp:write_u16(pn + i * 2, 0)
          end
          p = p .. string.format("  avg %d/%d/%d/%d", a[1], a[2], a[3], a[4])
        end
      end
      print(string.format("XMTEST frame %d: game frames %d (+%d), dropped %d (+%d) %s%s", frames, c, c - last_c, d, d - last_d, what, p))
      last_d, last_c = d, c
    end
  end
  if frames >= 15000 then manager.machine:exit() end
end
if emu.add_machine_frame_notifier then
  XM_SUB = emu.add_machine_frame_notifier(tick)
else
  emu.register_frame_done(tick)
end
