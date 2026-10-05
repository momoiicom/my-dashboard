ALTER TABLE "Board" ADD COLUMN "appearanceMainToolbar" TEXT CHECK ("appearanceMainToolbar" IS NULL OR "appearanceMainToolbar" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "Board" ADD COLUMN "appearanceBoardToolbar" TEXT CHECK ("appearanceBoardToolbar" IS NULL OR "appearanceBoardToolbar" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "Board" ADD COLUMN "appearanceCard" TEXT CHECK ("appearanceCard" IS NULL OR "appearanceCard" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "Board" ADD COLUMN "appearanceButton" TEXT CHECK ("appearanceButton" IS NULL OR "appearanceButton" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "ViewerAppearance" ADD COLUMN "mainToolbar" TEXT CHECK ("mainToolbar" IS NULL OR "mainToolbar" = 'auto' OR "mainToolbar" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "ViewerAppearance" ADD COLUMN "boardToolbar" TEXT CHECK ("boardToolbar" IS NULL OR "boardToolbar" = 'auto' OR "boardToolbar" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "ViewerAppearance" ADD COLUMN "card" TEXT CHECK ("card" IS NULL OR "card" = 'auto' OR "card" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
ALTER TABLE "ViewerAppearance" ADD COLUMN "button" TEXT CHECK ("button" IS NULL OR "button" = 'auto' OR "button" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]');
