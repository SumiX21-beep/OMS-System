import { Module } from '@nestjs/common';
import { AtpService } from './atp.service';
import { InboundService } from './inbound.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, AtpService, InboundService],
  exports: [InventoryService, AtpService, InboundService],
})
export class InventoryModule {}
