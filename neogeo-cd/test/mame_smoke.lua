-- MAME smoke test (CI): boot the disc, let the title fall into attract mode (CPU vs CPU),
-- snapshot every 10 s and print DATlib's frame counters (dropped frames = the 68000 ran late).
local frames = 0
local drop = tonumber(os.getenv("XM_DROP_ADDR") or "0") or 0
local count = tonumber(os.getenv("XM_FRAME_ADDR") or "0") or 0
local last_d, last_c = 0, 0
local function tick()
  frames = frames + 1
  if frames % 600 == 0 then
    manager.machine.video:snapshot()
    local cpu = manager.machine.devices[":maincpu"]
    if cpu and drop > 0 then
      local sp = cpu.spaces["program"]
      local d, c = sp:read_u32(drop), sp:read_u32(count)
      print(string.format("XMTEST frame %d: game frames %d (+%d), dropped %d (+%d)", frames, c, c - last_c, d, d - last_d))
      last_d, last_c = d, c
    end
  end
  if frames >= 9000 then manager.machine:exit() end
end
if emu.add_machine_frame_notifier then
  XM_SUB = emu.add_machine_frame_notifier(tick)
else
  emu.register_frame_done(tick)
end
