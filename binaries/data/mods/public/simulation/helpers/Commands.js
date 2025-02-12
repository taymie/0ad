// Setting this to true will display some warnings when commands
//	are likely to fail, which may be useful for debugging AIs
var g_DebugCommands = false;

function ProcessCommand(player, cmd)
{
	// Do some basic checks here that commanding player is valid
	var cmpPlayerMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	if (!cmpPlayerMan || player < 0)
		return;

	var playerEnt = cmpPlayerMan.GetPlayerByID(player);
	if (playerEnt == INVALID_ENTITY)
		return;

	var cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer)
		return;

	var controlAllUnits = cmpPlayer.CanControlAllUnits();

	var entities;
	if (cmd.entities)
		entities = FilterEntityList(cmd.entities, player, controlAllUnits);


	// Note: checks of UnitAI targets are not robust enough here, as ownership
	//	can change after the order is issued, they should be checked by UnitAI
	//	when the specific behavior (e.g. attack, garrison) is performed.
	// (Also it's not ideal if a command silently fails, it's nicer if UnitAI
	//	moves the entities closer to the target before giving up.)

	// Now handle various commands
	switch (cmd.type)
	{
	case "debug-print":
		print(cmd.message);
		break;
	
	case "chat":
		var cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		cmpGuiInterface.PushNotification({"type": "chat", "player": player, "message": cmd.message});
		break;
		
	case "cheat":
		Cheat(cmd);
		break;
		
	case "quit":
		// Let the AI exit the game for testing purposes
		var cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		cmpGuiInterface.PushNotification({"type": "quit"});
		break;

	case "diplomacy":
		switch(cmd.to)
		{
		case "ally":
			cmpPlayer.SetAlly(cmd.player);
			break;
		case "neutral":
			cmpPlayer.SetNeutral(cmd.player);
			break;
		case "enemy":
			cmpPlayer.SetEnemy(cmd.player);
			break;
		default:
			warn("Invalid command: Could not set "+player+" diplomacy status of player "+cmd.player+" to "+cmd.to);
		}
		var cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		cmpGuiInterface.PushNotification({"type": "diplomacy", "player": player, "player1": cmd.player, "status": cmd.to});
		break;

	case "tribute":
		cmpPlayer.TributeResource(cmd.player, cmd.amounts);
		break;

	case "control-all":
		cmpPlayer.SetControlAllUnits(cmd.flag);
		break;

	case "reveal-map":
		// Reveal the map for all players, not just the current player,
		// primarily to make it obvious to everyone that the player is cheating
		var cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
		cmpRangeManager.SetLosRevealAll(-1, cmd.enable);
		break;

	case "walk":
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.Walk(cmd.x, cmd.z, cmd.queued);
		});
		break;

	case "attack-walk":
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.WalkAndFight(cmd.x, cmd.z, cmd.queued);
		});
		break;

	case "attack":
		if (g_DebugCommands && !(IsOwnedByEnemyOfPlayer(player, cmd.target) || IsOwnedByNeutralOfPlayer(player, cmd.target)))
		{
			// This check is for debugging only!
			warn("Invalid command: attack target is not owned by enemy of player "+player+": "+uneval(cmd));
		}

		// See UnitAI.CanAttack for target checks
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.Attack(cmd.target, cmd.queued);
		});
		break;

	case "heal":
		if (g_DebugCommands && !(IsOwnedByPlayer(player, cmd.target) || IsOwnedByAllyOfPlayer(player, cmd.target)))
		{
			// This check is for debugging only!
			warn("Invalid command: heal target is not owned by player "+player+" or their ally: "+uneval(cmd));
		}

		// See UnitAI.CanHeal for target checks
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.Heal(cmd.target, cmd.queued);
		});
		break;

	case "repair":
		// This covers both repairing damaged buildings, and constructing unfinished foundations
		if (g_DebugCommands && !IsOwnedByAllyOfPlayer(player, cmd.target))
		{
			// This check is for debugging only!
			warn("Invalid command: repair target is not owned by ally of player "+player+": "+uneval(cmd));
		}

		// See UnitAI.CanRepair for target checks
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.Repair(cmd.target, cmd.autocontinue, cmd.queued);
		});
		break;

	case "gather":
		if (g_DebugCommands && !(IsOwnedByPlayer(player, cmd.target) || IsOwnedByGaia(cmd.target)))
		{
			// This check is for debugging only!
			warn("Invalid command: resource is not owned by gaia or player "+player+": "+uneval(cmd));
		}

		// See UnitAI.CanGather for target checks
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.Gather(cmd.target, cmd.queued);
		});
		break;
		
	case "gather-near-position":
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.GatherNearPosition(cmd.x, cmd.z, cmd.resourceType, cmd.resourceTemplate, cmd.queued);
		});
		break;

	case "returnresource":
		// Check dropsite is owned by player
		if (g_DebugCommands && !IsOwnedByPlayer(player, cmd.target))
		{
			// This check is for debugging only!
			warn("Invalid command: dropsite is not owned by player "+player+": "+uneval(cmd));
		}

		// See UnitAI.CanReturnResource for target checks
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.ReturnResource(cmd.target, cmd.queued);
		});
		break;

	case "train":
		// Check entity limits
		var cmpTempMan = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
		var template = cmpTempMan.GetTemplate(cmd.template);
		var unitCategory = null;
		if (template.TrainingRestrictions)
			unitCategory = template.TrainingRestrictions.Category;

		// Verify that the building(s) can be controlled by the player
		if (entities.length > 0)
		{
			for each (var ent in entities)
			{
				if (unitCategory)
				{
					var cmpPlayerEntityLimits = QueryOwnerInterface(ent, IID_EntityLimits);
					if (!cmpPlayerEntityLimits.AllowedToTrain(unitCategory, cmd.count))
					{
						if (g_DebugCommands)
							warn(unitCategory + " train limit is reached: " + uneval(cmd));
						continue;
					}
				}

				var cmpTechnologyManager = QueryOwnerInterface(ent, IID_TechnologyManager);
				// TODO: Enable this check once the AI gets technology support
				if (cmpTechnologyManager.CanProduce(cmd.template) || cmpPlayer.IsAI())
				{
					var queue = Engine.QueryInterface(ent, IID_ProductionQueue);
					// Check if the building can train the unit
					if (queue && queue.GetEntitiesList().indexOf(cmd.template) != -1)
						queue.AddBatch(cmd.template, "unit", +cmd.count, cmd.metadata);
				}
				else if (g_DebugCommands)
				{
					warn("Invalid command: training requires unresearched technology: " + uneval(cmd));
				}
			}
		}
		else if (g_DebugCommands)
		{
			warn("Invalid command: training building(s) cannot be controlled by player "+player+": "+uneval(cmd));
		}
		break;

	case "research":
		// Verify that the building can be controlled by the player
		if (CanControlUnit(cmd.entity, player, controlAllUnits))
		{
			var cmpTechnologyManager = QueryOwnerInterface(cmd.entity, IID_TechnologyManager);
			// TODO: Enable this check once the AI gets technology support
			if (cmpTechnologyManager.CanResearch(cmd.template) || cmpPlayer.IsAI())
			{
				var queue = Engine.QueryInterface(cmd.entity, IID_ProductionQueue);
				if (queue)
					queue.AddBatch(cmd.template, "technology");
			}
			else if (g_DebugCommands)
			{
				warn("Invalid command: Requirements to research technology are not met: " + uneval(cmd));
			}
		}
		else if (g_DebugCommands)
		{
			warn("Invalid command: research building cannot be controlled by player "+player+": "+uneval(cmd));
		}
		break;

	case "stop-production":
		// Verify that the building can be controlled by the player
		if (CanControlUnit(cmd.entity, player, controlAllUnits))
		{
			var queue = Engine.QueryInterface(cmd.entity, IID_ProductionQueue);
			if (queue)
				queue.RemoveBatch(cmd.id);
		}
		else if (g_DebugCommands)
		{
			warn("Invalid command: production building cannot be controlled by player "+player+": "+uneval(cmd));
		}
		break;

	case "construct":
		TryConstructBuilding(player, cmpPlayer, controlAllUnits, cmd);
		break;

	case "construct-wall":
		TryConstructWall(player, cmpPlayer, controlAllUnits, cmd);
		break;

	case "delete-entities":
		for each (var ent in entities)
		{
			var cmpHealth = Engine.QueryInterface(ent, IID_Health);
			if (cmpHealth)
			{
				var cmpResourceSupply = Engine.QueryInterface(ent, IID_ResourceSupply);
				if (!cmpResourceSupply || !cmpResourceSupply.GetKillBeforeGather())
					cmpHealth.Kill();
			}
			else
				Engine.DestroyEntity(ent);
		}
		break;

	case "set-rallypoint":
		for each (var ent in entities)
		{
			var cmpRallyPoint = Engine.QueryInterface(ent, IID_RallyPoint);
			if (cmpRallyPoint)
			{
				if (!cmd.queued)
					cmpRallyPoint.Unset();

				cmpRallyPoint.AddPosition(cmd.x, cmd.z);
				cmpRallyPoint.AddData(cmd.data);
			}
		}
		break;

	case "unset-rallypoint":
		for each (var ent in entities)
		{
			var cmpRallyPoint = Engine.QueryInterface(ent, IID_RallyPoint);
			if (cmpRallyPoint)
				cmpRallyPoint.Unset();
		}
		break;

	case "defeat-player":
		// Send "OnPlayerDefeated" message to player
		Engine.PostMessage(playerEnt, MT_PlayerDefeated, { "playerId": player } );
		break;

	case "garrison":
		// Verify that the building can be controlled by the player or is mutualAlly
		if (CanControlUnitOrIsAlly(cmd.target, player, controlAllUnits))
		{
			GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
				cmpUnitAI.Garrison(cmd.target, cmd.queued);
			});
		}
		else if (g_DebugCommands)
		{
			warn("Invalid command: garrison target cannot be controlled by player "+player+" (or ally): "+uneval(cmd));
		}
		break;

	case "stop":
		GetFormationUnitAIs(entities, player).forEach(function(cmpUnitAI) {
			cmpUnitAI.Stop(cmd.queued);
		});
		break;

	case "unload":
		// Verify that the building can be controlled by the player or is mutualAlly
		if (CanControlUnitOrIsAlly(cmd.garrisonHolder, player, controlAllUnits))
		{
			var cmpGarrisonHolder = Engine.QueryInterface(cmd.garrisonHolder, IID_GarrisonHolder);
			var notUngarrisoned = 0;

			// The owner can ungarrison every garrisoned unit
			if (IsOwnedByPlayer(player, cmd.garrisonHolder))
				entities = cmd.entities;

			for each (var ent in entities)
				if (!cmpGarrisonHolder || !cmpGarrisonHolder.Unload(ent))
					notUngarrisoned++;

			if (notUngarrisoned != 0)
				notifyUnloadFailure(player, cmd.garrisonHolder)
		}
		else if (g_DebugCommands)
		{
			warn("Invalid command: unload target cannot be controlled by player "+player+" (or ally): "+uneval(cmd));
		}
		break;

	case "unload-template":
		var index = cmd.template.indexOf("&");  // Templates for garrisoned units are extended
		if (index == -1)
			break;

		var entities = FilterEntityListWithAllies(cmd.garrisonHolders, player, controlAllUnits);
		for each (var garrisonHolder in entities)
		{
			var cmpGarrisonHolder = Engine.QueryInterface(garrisonHolder, IID_GarrisonHolder);
			if (cmpGarrisonHolder)
			{
				// Only the owner of the garrisonHolder may unload entities from any owners
				if (!IsOwnedByPlayer(player, garrisonHolder) && !controlAllUnits
				    && player != +cmd.template.slice(1,index))
						continue;

				if (!cmpGarrisonHolder.UnloadTemplate(cmd.template, cmd.all))
					notifyUnloadFailure(player, garrisonHolder);
			}
		}
		break;

	case "unload-all-own":
		var entities = FilterEntityList(cmd.garrisonHolders, player, controlAllUnits);
		for each (var garrisonHolder in entities)
		{
			var cmpGarrisonHolder = Engine.QueryInterface(garrisonHolder, IID_GarrisonHolder);
			if (!cmpGarrisonHolder || !cmpGarrisonHolder.UnloadAllOwn())
				notifyUnloadFailure(player, garrisonHolder)
		}
		break;

	case "unload-all":
		var entities = FilterEntityList(cmd.garrisonHolders, player, controlAllUnits);
		for each (var garrisonHolder in entities)
		{
			var cmpGarrisonHolder = Engine.QueryInterface(garrisonHolder, IID_GarrisonHolder);
			if (!cmpGarrisonHolder || !cmpGarrisonHolder.UnloadAll())
				notifyUnloadFailure(player, garrisonHolder)
		}
		break;

	case "formation":
		GetFormationUnitAIs(entities, player, cmd.name).forEach(function(cmpUnitAI) {
			cmpUnitAI.MoveIntoFormation(cmd);
		});
		break;

	case "promote":
		// No need to do checks here since this is a cheat anyway
		var cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		cmpGuiInterface.PushNotification({"type": "chat", "player": player, "message": "(Cheat - promoted units)"});

		for each (var ent in cmd.entities)
		{
			var cmpPromotion = Engine.QueryInterface(ent, IID_Promotion);
			if (cmpPromotion)
				cmpPromotion.IncreaseXp(cmpPromotion.GetRequiredXp() - cmpPromotion.GetCurrentXp());
		}
		break;

	case "stance":
		for each (var ent in entities)
		{
			var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (cmpUnitAI)
				cmpUnitAI.SwitchToStance(cmd.name);
		}
		break;

	case "wall-to-gate":
		for each (var ent in entities)
		{
			TryTransformWallToGate(ent, cmpPlayer, cmd.template);
		}
		break;

	case "lock-gate":
		for each (var ent in entities)
		{
			var cmpGate = Engine.QueryInterface(ent, IID_Gate);
			if (cmpGate)
			{
				if (cmd.lock)
					cmpGate.LockGate();
				else
					cmpGate.UnlockGate();
			}
		}
		break;

	case "setup-trade-route":
		for each (var ent in entities)
		{
			var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (cmpUnitAI)
				cmpUnitAI.SetupTradeRoute(cmd.target, cmd.source);
		}
		break;

	case "select-trading-goods":
		for each (var ent in entities)
		{
			var cmpTrader = Engine.QueryInterface(ent, IID_Trader);
			if (cmpTrader)
				cmpTrader.SetPreferredGoods(cmd.preferredGoods);
		}
		break;

	case "barter":
		var cmpBarter = Engine.QueryInterface(SYSTEM_ENTITY, IID_Barter);
		cmpBarter.ExchangeResources(playerEnt, cmd.sell, cmd.buy, cmd.amount);
		break;
		
	case "set-shading-color":
		// Debug command to make an entity brightly colored
		for each (var ent in cmd.entities)
		{
			var cmpVisual = Engine.QueryInterface(ent, IID_Visual)
			if (cmpVisual)
				cmpVisual.SetShadingColour(cmd.rgb[0], cmd.rgb[1], cmd.rgb[2], 0) // alpha isn't used so just send 0
		}
		break;

	case "pack":
		for each (var ent in entities)
		{
			var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (cmpUnitAI)
			{
				if (cmd.pack)
					cmpUnitAI.Pack(cmd.queued);
				else
					cmpUnitAI.Unpack(cmd.queued);
			}
		}
		break;

	case "cancel-pack":
		for each (var ent in entities)
		{
			var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (cmpUnitAI)
			{
				if (cmd.pack)
					cmpUnitAI.CancelPack(cmd.queued);
				else
					cmpUnitAI.CancelUnpack(cmd.queued);
			}
		}
		break;

	default:
		error("Invalid command: unknown command type: "+uneval(cmd));
	}
}

/**
 * Sends a GUI notification about unit(s) that failed to ungarrison.
 */
function notifyUnloadFailure(player, garrisonHolder)
{
	var cmpPlayer = QueryPlayerIDInterface(player, IID_Player);
	var notification = {"player": cmpPlayer.GetPlayerID(), "message": "Unable to ungarrison unit(s)" };
	var cmpGUIInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
	cmpGUIInterface.PushNotification(notification);
}

/**
 * Get some information about the formations used by entities.
 * The entities must have a UnitAI component.
 */
function ExtractFormations(ents)
{
	var entities = []; // subset of ents that have UnitAI
	var members = {}; // { formationentity: [ent, ent, ...], ... }
	for each (var ent in ents)
	{
		var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		var fid = cmpUnitAI.GetFormationController();
		if (fid != INVALID_ENTITY)
		{
			if (!members[fid])
				members[fid] = [];
			members[fid].push(ent);
		}
		entities.push(ent);
	}

	var ids = [ id for (id in members) ];

	return { "entities": entities, "members": members, "ids": ids };
}

/**
 * Tries to find the best angle to put a dock at a given position
 * Taken from GuiInterface.js
 */
function GetDockAngle(templateName,x,y)
{
	var cmpTemplateMgr = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	var template = cmpTemplateMgr.GetTemplate(templateName);

	if (template.BuildRestrictions.Category !== "Dock")
		return undefined;

	var cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	var cmpWaterManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_WaterManager);
	if (!cmpTerrain || !cmpWaterManager)
	{
		return undefined;
	}
	
	// Get footprint size
	var halfSize = 0;
	if (template.Footprint.Square)
	{
		halfSize = Math.max(template.Footprint.Square["@depth"], template.Footprint.Square["@width"])/2;
	}
	else if (template.Footprint.Circle)
	{
		halfSize = template.Footprint.Circle["@radius"];
	}
	
	/* Find direction of most open water, algorithm:
	 *	1. Pick points in a circle around dock
	 *	2. If point is in water, add to array
	 *	3. Scan array looking for consecutive points
	 *	4. Find longest sequence of consecutive points
	 *	5. If sequence equals all points, no direction can be determined,
	 *		expand search outward and try (1) again
	 *	6. Calculate angle using average of sequence
	 */
	const numPoints = 16;
	for (var dist = 0; dist < 4; ++dist)
	{
		var waterPoints = [];
		for (var i = 0; i < numPoints; ++i)
		{
			var angle = (i/numPoints)*2*Math.PI;
			var d = halfSize*(dist+1);
			var nx = x - d*Math.sin(angle);
			var nz = y + d*Math.cos(angle);
			
			if (cmpTerrain.GetGroundLevel(nx, nz) < cmpWaterManager.GetWaterLevel(nx, nz))
			{
				waterPoints.push(i);
			}
		}
		var consec = [];
		var length = waterPoints.length;
		for (var i = 0; i < length; ++i)
		{
			var count = 0;
			for (var j = 0; j < (length-1); ++j)
			{
				if (((waterPoints[(i + j) % length]+1) % numPoints) == waterPoints[(i + j + 1) % length])
				{
					++count;
				}
				else
				{
					break;
				}
			}
			consec[i] = count;
		}
		var start = 0;
		var count = 0;
		for (var c in consec)
		{
			if (consec[c] > count)
			{
				start = c;
				count = consec[c];
			}
		}
		
		// If we've found a shoreline, stop searching
		if (count != numPoints-1)
		{
			return -(((waterPoints[start] + consec[start]/2) % numPoints)/numPoints*2*Math.PI);
		}
	}
	return undefined;
}

/**
 * Attempts to construct a building using the specified parameters.
 * Returns true on success, false on failure.
 */
function TryConstructBuilding(player, cmpPlayer, controlAllUnits, cmd)
{
	// Message structure:
	// {
	//   "type": "construct",
	//   "entities": [...],                 // entities that will be ordered to construct the building (if applicable)
	//   "template": "...",                 // template name of the entity being constructed
	//   "x": ...,
	//   "z": ...,
	//   "angle": ...,
	//   "metadata": "...",                 // AI metadata of the building
	//   "actorSeed": ...,
	//   "autorepair": true,                // whether to automatically start constructing/repairing the new foundation
	//   "autocontinue": true,              // whether to automatically gather/build/etc after finishing this
	//   "queued": true,                    // whether to add the construction/repairing of this foundation to entities' queue (if applicable)
	//   "obstructionControlGroup": ...,    // Optional; the obstruction control group ID that should be set for this building prior to obstruction
	//                                      // testing to determine placement validity. If specified, must be a valid control group ID (> 0).
	//   "obstructionControlGroup2": ...,   // Optional; secondary obstruction control group ID that should be set for this building prior to obstruction
	//                                      // testing to determine placement validity. May be INVALID_ENTITY.
	// }
	
	/*
	 * Construction process:
	 *  . Take resources away immediately.
	 *  . Create a foundation entity with 1hp, 0% build progress.
	 *  . Increase hp and build progress up to 100% when people work on it.
	 *  . If it's destroyed, an appropriate fraction of the resource cost is refunded.
	 *  . If it's completed, it gets replaced with the real building.
	 */
	
	// Check whether we can control these units
	var entities = FilterEntityList(cmd.entities, player, controlAllUnits);
	if (!entities.length)
		return false;
	
	var foundationTemplate = "foundation|" + cmd.template;
	
	// Tentatively create the foundation (we might find later that it's a invalid build command)
	var ent = Engine.AddEntity(foundationTemplate);
	if (ent == INVALID_ENTITY)
	{
		// Error (e.g. invalid template names)
		error("Error creating foundation entity for '" + cmd.template + "'");
		return false;
	}
	
	// If it's a dock, get the right angle.
	var angle = GetDockAngle(cmd.template,cmd.x,cmd.z);
	if (angle !== undefined)
		cmd.angle = angle;
	
	// Move the foundation to the right place
	var cmpPosition = Engine.QueryInterface(ent, IID_Position);
	cmpPosition.JumpTo(cmd.x, cmd.z);
	cmpPosition.SetYRotation(cmd.angle);
	
	// Set the obstruction control group if needed
	if (cmd.obstructionControlGroup || cmd.obstructionControlGroup2)
	{
		var cmpObstruction = Engine.QueryInterface(ent, IID_Obstruction);
		
		// primary control group must always be valid
		if (cmd.obstructionControlGroup)
		{
			if (cmd.obstructionControlGroup <= 0)
				warn("[TryConstructBuilding] Invalid primary obstruction control group " + cmd.obstructionControlGroup + " received; must be > 0");
			
			cmpObstruction.SetControlGroup(cmd.obstructionControlGroup);
		}
		
		if (cmd.obstructionControlGroup2)
			cmpObstruction.SetControlGroup2(cmd.obstructionControlGroup2);
	}
	
	// Make it owned by the current player
	var cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
	cmpOwnership.SetOwner(player);
	
	// Check whether building placement is valid
	var cmpBuildRestrictions = Engine.QueryInterface(ent, IID_BuildRestrictions);
	if (cmpBuildRestrictions)
	{
		var ret = cmpBuildRestrictions.CheckPlacement();
		if (!ret.success)
		{
			if (g_DebugCommands)
			{
				warn("Invalid command: build restrictions check failed for player "+player+": "+uneval(cmd));
			}

			var cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
			cmpGuiInterface.PushNotification({ "player": player, "message": ret.message });
			
			// Remove the foundation because the construction was aborted
			Engine.DestroyEntity(ent);
			return false;
		}
	}
	else
		error("cmpBuildRestrictions not defined");
	
	// Check entity limits
	var cmpEntityLimits = QueryPlayerIDInterface(player, IID_EntityLimits);
	if (!cmpEntityLimits || !cmpEntityLimits.AllowedToBuild(cmpBuildRestrictions.GetCategory()))
	{
		if (g_DebugCommands)
		{
			warn("Invalid command: build limits check failed for player "+player+": "+uneval(cmd));
		}

		// Remove the foundation because the construction was aborted
		Engine.DestroyEntity(ent);
		return false;
	}
	
	var cmpTechnologyManager = QueryPlayerIDInterface(player, IID_TechnologyManager);
	
	// TODO: Enable this check once the AI gets technology support 
	if (!cmpTechnologyManager.CanProduce(cmd.template) && !cmpPlayer.IsAI()) 
	{
		if (g_DebugCommands)
		{
			warn("Invalid command: required technology check failed for player "+player+": "+uneval(cmd));
		}
		
		var cmpGuiInterface = Engine.QueryInterface(SYSTEM_ENTITY, IID_GuiInterface);
		cmpGuiInterface.PushNotification({ "player": player, "message": "Building's technology requirements are not met." }); 
		
		// Remove the foundation because the construction was aborted 
		Engine.DestroyEntity(ent); 
	}
	
	// We need the cost after tech modifications
	// To calculate this with an entity requires ownership, so use the template instead
	var cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	var template = cmpTemplateManager.GetTemplate(foundationTemplate);
	var costs = {};
	for (var r in template.Cost.Resources)
	{
		costs[r] = +template.Cost.Resources[r];
		if (cmpTechnologyManager)
			costs[r] = cmpTechnologyManager.ApplyModificationsTemplate("Cost/Resources/"+r, costs[r], template);
	}
	
	if (!cmpPlayer.TrySubtractResources(costs))
	{
		if (g_DebugCommands)
			warn("Invalid command: building cost check failed for player "+player+": "+uneval(cmd));
		
		Engine.DestroyEntity(ent);
		return false;
	}

	var cmpVisual = Engine.QueryInterface(ent, IID_Visual);
	if (cmpVisual && cmd.actorSeed !== undefined)
		cmpVisual.SetActorSeed(cmd.actorSeed);

	// Initialise the foundation
	var cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
	cmpFoundation.InitialiseConstruction(player, cmd.template);

	// send Metadata info if any
	if (cmd.metadata)
		Engine.PostMessage(ent, MT_AIMetadata, { "id": ent, "metadata" : cmd.metadata, "owner" : player } );
	
	// Tell the units to start building this new entity
	if (cmd.autorepair)
	{
		ProcessCommand(player, {
			"type": "repair",
			"entities": entities,
			"target": ent,
			"autocontinue": cmd.autocontinue,
			"queued": cmd.queued
		});
	}

	return ent;
}

function TryConstructWall(player, cmpPlayer, controlAllUnits, cmd)
{
	// 'cmd' message structure:
	// {
	//   "type": "construct-wall",
	//   "entities": [...],           // entities that will be ordered to construct the wall (if applicable)
	//   "pieces": [                  // ordered list of information about the pieces making up the wall (towers, wall segments, ...)
	//      {
	//         "template": "...",     // one of the templates from the wallset
	//         "x": ...,
	//         "z": ...,
	//         "angle": ...,
	//      },
	//      ...
	//   ],
	//   "wallSet": {
	//      "templates": {
	//        "tower":                // tower template name
	//        "long":                 // long wall segment template name
	//        ...                     // etc.
	//      },
	//      "maxTowerOverlap": ...,
	//      "minTowerOverlap": ...,
	//   },
	//   "startSnappedEntity":        // optional; entity ID of tower being snapped to at the starting side of the wall
	//   "endSnappedEntity":          // optional; entity ID of tower being snapped to at the ending side of the wall
	//   "autorepair": true,          // whether to automatically start constructing/repairing the new foundation
	//   "autocontinue": true,        // whether to automatically gather/build/etc after finishing this
	//   "queued": true,              // whether to add the construction/repairing of this wall's pieces to entities' queue (if applicable)
	// }
	
	if (cmd.pieces.length <= 0)
		return;
	
	if (cmd.startSnappedEntity && cmd.pieces[0].template == cmd.wallSet.templates.tower)
	{
		error("[TryConstructWall] Starting wall piece cannot be a tower (" + cmd.wallSet.templates.tower + ") when snapping at the starting side");
		return;
	}
	
	if (cmd.endSnappedEntity && cmd.pieces[cmd.pieces.length - 1].template == cmd.wallSet.templates.tower)
	{
		error("[TryConstructWall] Ending wall piece cannot be a tower (" + cmd.wallSet.templates.tower + ") when snapping at the ending side");
		return;
	}
	
	// Assign obstruction control groups to allow the wall pieces to mutually overlap during foundation placement
	// and during construction. The scheme here is that whatever wall pieces are inbetween two towers inherit the control 
	// groups of both of the towers they are connected to (either newly constructed ones as part of the wall, or existing
	// towers in the case of snapping). The towers themselves all keep their default unique control groups.
	
	// To support this, every non-tower piece registers the entity ID of the towers (or foundations thereof) that neighbour
	// it on either side. Specifically, each non-tower wall piece has its primary control group set equal to that of the 
	// first tower encountered towards the starting side of the wall, and its secondary control group set equal to that of
	// the first tower encountered towards the ending side of the wall (if any).
	
	// We can't build the whole wall at once by linearly stepping through the wall pieces and build them, because the 
	// wall segments may/will need the entity IDs of towers that come afterwards. So, build it in two passes:
	// 
	//   FIRST PASS:
	//    - Go from start to end and construct wall piece foundations as far as we can without running into a piece that
	//        cannot be built (e.g. because it is obstructed). At each non-tower, set the most recently built tower's ID
	//        as the primary control group, thus allowing it to be built overlapping the previous piece.
	//    - If we encounter a new tower along the way (which will gain its own control group), do the following:
	//        o First build it using temporarily the same control group of the previous (non-tower) piece
	//        o Set the previous piece's secondary control group to the tower's entity ID
	//        o Restore the primary control group of the constructed tower back its original (unique) value.
	//      The temporary control group is necessary to allow the newer tower with its unique control group ID to be able
	//        to be placed while overlapping the previous piece.
	//   
	//   SECOND PASS:   
	//    - Go end to start from the last successfully placed wall piece (which might be a tower we backtracked to), this
	//      time registering the right neighbouring tower in each non-tower piece.
	
	// first pass; L -> R
	
	var lastTowerIndex = -1; // index of the last tower we've encountered in cmd.pieces
	var lastTowerControlGroup = null; // control group of the last tower we've encountered, to assign to non-tower pieces
	
	// If we're snapping to an existing entity at the starting end, set lastTowerControlGroup to its control group ID so that
	// the first wall piece can be built while overlapping it.
	if (cmd.startSnappedEntity)
	{
		var cmpSnappedStartObstruction = Engine.QueryInterface(cmd.startSnappedEntity, IID_Obstruction);
		if (!cmpSnappedStartObstruction)
		{
			error("[TryConstructWall] Snapped entity on starting side does not have an obstruction component");
			return;
		}
		
		lastTowerControlGroup = cmpSnappedStartObstruction.GetControlGroup();
		//warn("setting lastTowerControlGroup to control group of start snapped entity " + cmd.startSnappedEntity + ": " + lastTowerControlGroup);
	}
	
	var i = 0;
	for (; i < cmd.pieces.length; ++i)
	{
		var piece = cmd.pieces[i];

		// All wall pieces after the first must be queued.
		if (i > 0 && !cmd.queued)
			cmd.queued = true;

		// 'lastTowerControlGroup' must always be defined and valid here, except if we're at the first piece and we didn't do
		// start position snapping (implying that the first entity we build must be a tower)
		if (lastTowerControlGroup === null || lastTowerControlGroup == INVALID_ENTITY)
		{
			if (!(i == 0 && piece.template == cmd.wallSet.templates.tower && !cmd.startSnappedEntity))
			{
    			error("[TryConstructWall] Expected last tower control group to be available, none found (1st pass, iteration " + i + ")");
    			break;
			}
		}
		
		var constructPieceCmd = {
			"type": "construct",
			"entities": cmd.entities,
			"template": piece.template,
			"x": piece.x,
			"z": piece.z,
			"angle": piece.angle,
			"autorepair": cmd.autorepair,
			"autocontinue": cmd.autocontinue,
			"queued": cmd.queued,
			// Regardless of whether we're building a tower or an intermediate wall piece, it is always (first) constructed
			// using the control group of the last tower (see comments above).
			"obstructionControlGroup": lastTowerControlGroup,
		};
		
		// If we're building the last piece and we're attaching to a snapped entity, we need to add in the snapped entity's
		// control group directly at construction time (instead of setting it in the second pass) to allow it to be built
		// while overlapping the snapped entity.
		if (i == cmd.pieces.length - 1 && cmd.endSnappedEntity)
		{
			var cmpEndSnappedObstruction = Engine.QueryInterface(cmd.endSnappedEntity, IID_Obstruction);
			if (cmpEndSnappedObstruction)
				constructPieceCmd.obstructionControlGroup2 = cmpEndSnappedObstruction.GetControlGroup();
		}
		
		var pieceEntityId = TryConstructBuilding(player, cmpPlayer, controlAllUnits, constructPieceCmd);
		if (pieceEntityId)
		{
			// wall piece foundation successfully built, save the entity ID in the piece info object so we can reference it later
			piece.ent = pieceEntityId;
			
			// if we built a tower, do the control group dance (see outline above) and update lastTowerControlGroup and lastTowerIndex
			if (piece.template == cmd.wallSet.templates.tower)
			{
				var cmpTowerObstruction = Engine.QueryInterface(pieceEntityId, IID_Obstruction);
				var newTowerControlGroup = pieceEntityId;
				
				if (i > 0)
				{
					//warn("   updating previous wall piece's secondary control group to " + newTowerControlGroup);
					var cmpPreviousObstruction = Engine.QueryInterface(cmd.pieces[i-1].ent, IID_Obstruction);
					// TODO: ensure that cmpPreviousObstruction exists
					// TODO: ensure that the previous obstruction does not yet have a secondary control group set
					cmpPreviousObstruction.SetControlGroup2(newTowerControlGroup);
				}
				
				// TODO: ensure that cmpTowerObstruction exists
				cmpTowerObstruction.SetControlGroup(newTowerControlGroup); // give the tower its own unique control group
				
				lastTowerIndex = i;
				lastTowerControlGroup = newTowerControlGroup;
			}
		}
		else
		{
			// failed to build wall piece, abort
			i = j + 1; // compensate for the -1 subtracted by lastBuiltPieceIndex below
			break;
		}
	}
	
	var lastBuiltPieceIndex = i - 1;
	var wallComplete = (lastBuiltPieceIndex == cmd.pieces.length - 1);
	
	// At this point, 'i' is the index of the last wall piece that was successfully constructed (which may or may not be a tower).
	// Now do the second pass going right-to-left, registering the control groups of the towers to the right of each piece (if any)
	// as their secondary control groups.
	
	lastTowerControlGroup = null; // control group of the last tower we've encountered, to assign to non-tower pieces
	
	// only start off with the ending side's snapped tower's control group if we were able to build the entire wall
	if (cmd.endSnappedEntity && wallComplete)
	{
		var cmpSnappedEndObstruction = Engine.QueryInterface(cmd.endSnappedEntity, IID_Obstruction);
		if (!cmpSnappedEndObstruction)
		{
			error("[TryConstructWall] Snapped entity on ending side does not have an obstruction component");
			return;
		}
		
		lastTowerControlGroup = cmpSnappedEndObstruction.GetControlGroup();
	}
	
	for (var j = lastBuiltPieceIndex; j >= 0; --j)
	{
		var piece = cmd.pieces[j];
		
		if (!piece.ent)
		{
			error("[TryConstructWall] No entity ID set for constructed entity of template '" + piece.template + "'");
			continue;
		}
		
		var cmpPieceObstruction = Engine.QueryInterface(piece.ent, IID_Obstruction);
		if (!cmpPieceObstruction)
		{
			error("[TryConstructWall] Wall piece of template '" + piece.template + "' has no Obstruction component");
			continue;
		}
		
		if (piece.template == cmd.wallSet.templates.tower)
		{
			// encountered a tower entity, update the last tower control group
			lastTowerControlGroup = cmpPieceObstruction.GetControlGroup();
		}
		else
		{
			// Encountered a non-tower entity, update its secondary control group to 'lastTowerControlGroup'.
			// Note that the wall piece may already have its secondary control group set to the tower's entity ID from a control group
			// dance during the first pass, in which case we should validate it against 'lastTowerControlGroup'.
			
			var existingSecondaryControlGroup = cmpPieceObstruction.GetControlGroup2();
			if (existingSecondaryControlGroup == INVALID_ENTITY)
			{
				if (lastTowerControlGroup != null && lastTowerControlGroup != INVALID_ENTITY)
				{
					cmpPieceObstruction.SetControlGroup2(lastTowerControlGroup);
				}
			}
			else if (existingSecondaryControlGroup != lastTowerControlGroup)
			{
				error("[TryConstructWall] Existing secondary control group of non-tower entity does not match expected value (2nd pass, iteration " + j + ")");
				break;
			}
		}
	}
}

/**
 * Remove the given list of entities from their current formations.
 */
function RemoveFromFormation(ents)
{
	var formation = ExtractFormations(ents);
	for (var fid in formation.members)
	{
		var cmpFormation = Engine.QueryInterface(+fid, IID_Formation);
		if (cmpFormation)
			cmpFormation.RemoveMembers(formation.members[fid]);
	}
}

/**
 * Returns a list of UnitAI components, each belonging either to a
 * selected unit or to a formation entity for groups of the selected units.
 */
function GetFormationUnitAIs(ents, player, formName)
{
	// If an individual was selected, remove it from any formation
	// and command it individually
	if (ents.length == 1)
	{
		// Skip unit if it has no UnitAI
		var cmpUnitAI = Engine.QueryInterface(ents[0], IID_UnitAI);
		if (!cmpUnitAI)
			return [];

		RemoveFromFormation(ents);

		return [ cmpUnitAI ];
	}

	// Separate out the units that don't support the chosen formation
	var formedEnts = [];
	var nonformedUnitAIs = [];
	for each (var ent in ents)
	{
		// Skip units with no UnitAI
		var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI)
			continue;

		var cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		// TODO: We only check if the formation is usable by some units
		// if we move them to it. We should check if we can use formations
		// for the other cases.
		// We only use "LineClosed" instead of "Line Closed" to access the templates.
		if (cmpIdentity && cmpIdentity.CanUseFormation(formName === undefined ? "LineClosed" : formName.replace(/\s+/,'')))
			formedEnts.push(ent);
		else
			nonformedUnitAIs.push(cmpUnitAI);
	}

	if (formedEnts.length == 0)
	{
		// No units support the foundation - return all the others
		return nonformedUnitAIs;
	}

	// Find what formations the formationable selected entities are currently in
	var formation = ExtractFormations(formedEnts);

	var formationEnt = undefined;
	if (formation.ids.length == 1)
	{
		// Selected units either belong to this formation or have no formation
		// Check that all its members are selected
		var fid = formation.ids[0];
		var cmpFormation = Engine.QueryInterface(+fid, IID_Formation);
		if (cmpFormation && cmpFormation.GetMemberCount() == formation.members[fid].length
			&& cmpFormation.GetMemberCount() == formation.entities.length)
		{
			// The whole formation was selected, so reuse its controller for this command
			formationEnt = +fid;
		}
	}

	if (!formationEnt)
	{
		// We need to give the selected units a new formation controller

		// Remove selected units from their current formation
		for (var fid in formation.members)
		{
			var cmpFormation = Engine.QueryInterface(+fid, IID_Formation);
			if (cmpFormation)
				cmpFormation.RemoveMembers(formation.members[fid]);
		}

		// Create the new controller
		formationEnt = Engine.AddEntity("special/formation");
		var cmpFormation = Engine.QueryInterface(formationEnt, IID_Formation);
		cmpFormation.SetMembers(formation.entities);

		var cmpOwnership = Engine.QueryInterface(formationEnt, IID_Ownership);
		cmpOwnership.SetOwner(player);

		// If all the selected units were previously in formations of the same shape,
		// then set this new formation to that shape too; otherwise use the default shape
		var lastFormationName = undefined;
		for each (var ent in formation.entities)
		{
			var cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (cmpUnitAI)
			{
				var name = cmpUnitAI.GetLastFormationName();
				if (lastFormationName === undefined)
				{
					lastFormationName = name;
				}
				else if (lastFormationName != name)
				{
					lastFormationName = undefined;
					break;
				}
			}
		}
		var formationName;
		if (lastFormationName)
			formationName = lastFormationName;
		else
			formationName = "Line Closed";

		if (CanMoveEntsIntoFormation(formation.entities, formationName))
		{
			cmpFormation.LoadFormation(formationName);
		}
		else
		{
			cmpFormation.LoadFormation("Scatter");
		}
	}

	return nonformedUnitAIs.concat(Engine.QueryInterface(formationEnt, IID_UnitAI));
}

function GetFormationRequirements(formationName)
{
	var countRequired = 1;
 	var classesRequired;
	switch(formationName)
	{
	case "Scatter":
	case "Column Closed":
	case "Line Closed":
	case "Column Open":
	case "Line Open":
	case "Battle Line":
		break;
	case "Box":
		countRequired = 4;
		break;
	case "Flank":
		countRequired = 8;
		break;
	case "Skirmish":
		classesRequired = ["Ranged"];
		break;
	case "Wedge":
		countRequired = 3;
 		classesRequired = ["Cavalry"];
		break;
	case "Phalanx":
		countRequired = 10;
 		classesRequired = ["Melee", "Infantry"];
		break;
	case "Syntagma":
		countRequired = 9;
 		classesRequired = ["Melee", "Infantry"]; // TODO: pike only
		break;
	case "Testudo":
		countRequired = 9;
 		classesRequired = ["Melee", "Infantry"];
		break;
	default:
		// We encountered a unknown formation -> warn the user
		warn("Commands.js: GetFormationRequirements: unknown formation: " + formationName);
 		return false;
 	}
	return { "count": countRequired, "classesRequired": classesRequired };
}


function CanMoveEntsIntoFormation(ents, formationName)
{
	var count = ents.length;

	// TODO: should check the player's civ is allowed to use this formation
	// See simulation/components/Player.js GetFormations() for a list of all allowed formations

	var requirements = GetFormationRequirements(formationName);
	if (!requirements)
		return false;
	
	if (count < requirements.count)
		return false;

	var scatterOnlyUnits = true;
	for each (var ent in ents)
	{
		var cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		if (cmpIdentity)
		{
			var classes = cmpIdentity.GetClassesList();
			if (scatterOnlyUnits && (classes.indexOf("Worker") == -1 || classes.indexOf("Support") == -1))
				scatterOnlyUnits = false;
			for each (var classRequired in requirements.classesRequired)
			{
				if (classes.indexOf(classRequired) == -1)
				{
					return false;
				}
			}
		}
	}

	if (scatterOnlyUnits)
		return false;

	return true;
}

/**
 * Check if player can control this entity
 * returns: true if the entity is valid and owned by the player
 *          or control all units is activated, else false
 */
function CanControlUnit(entity, player, controlAll)
{
	return (IsOwnedByPlayer(player, entity) || controlAll);
}

/**
 * Check if player can control this entity
 * returns: true if the entity is valid and owned by the player
 *          or the entity is owned by an mutualAlly
 *          or control all units is activated, else false
 */
function CanControlUnitOrIsAlly(entity, player, controlAll)
{
	return (IsOwnedByPlayer(player, entity) || IsOwnedByMutualAllyOfPlayer(player, entity) || controlAll);
}

/**
 * Filter entities which the player can control
 */
function FilterEntityList(entities, player, controlAll)
{
	return entities.filter(function(ent) { return CanControlUnit(ent, player, controlAll);} );
}

/**
 * Filter entities which the player can control or are mutualAlly
 */
function FilterEntityListWithAllies(entities, player, controlAll)
{
	return entities.filter(function(ent) { return CanControlUnitOrIsAlly(ent, player, controlAll);} );
}

/**
 * Try to transform a wall to a gate 
 */
function TryTransformWallToGate(ent, cmpPlayer, template)
{
	var cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
	if (!cmpIdentity)
		return;

	// Check if this is a valid long wall segment
	if (!cmpIdentity.HasClass("LongWall"))
	{
		if (g_DebugCommands)
			warn("Invalid command: invalid wall conversion to gate for player "+player+": "+uneval(cmd));
		return;
	}

	var civ = cmpIdentity.GetCiv();
	var gate = Engine.AddEntity(template);

	var cmpCost = Engine.QueryInterface(gate, IID_Cost);
	if (!cmpPlayer.TrySubtractResources(cmpCost.GetResourceCosts()))
	{
		if (g_DebugCommands)
			warn("Invalid command: convert gate cost check failed for player "+player+": "+uneval(cmd));

		Engine.DestroyEntity(gate);
		return;
	}

	ReplaceBuildingWith(ent, gate);
}

/**
 * Unconditionally replace a building with another one
 */
function ReplaceBuildingWith(ent, building)
{
	// Move the building to the right place
	var cmpPosition = Engine.QueryInterface(ent, IID_Position);
	var cmpBuildingPosition = Engine.QueryInterface(building, IID_Position);
	var pos = cmpPosition.GetPosition2D();
	cmpBuildingPosition.JumpTo(pos.x, pos.y);
	var rot = cmpPosition.GetRotation();
	cmpBuildingPosition.SetYRotation(rot.y);
	cmpBuildingPosition.SetXZRotation(rot.x, rot.z);

	// Copy ownership
	var cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
	var cmpBuildingOwnership = Engine.QueryInterface(building, IID_Ownership);
	cmpBuildingOwnership.SetOwner(cmpOwnership.GetOwner());

	// Copy control groups
	var cmpObstruction = Engine.QueryInterface(ent, IID_Obstruction);
	var cmpBuildingObstruction = Engine.QueryInterface(building, IID_Obstruction);
	cmpBuildingObstruction.SetControlGroup(cmpObstruction.GetControlGroup());
	cmpBuildingObstruction.SetControlGroup2(cmpObstruction.GetControlGroup2());

	// Copy health level from the old entity to the new
	var cmpHealth = Engine.QueryInterface(ent, IID_Health);
	var cmpBuildingHealth = Engine.QueryInterface(building, IID_Health);
	var healthFraction = Math.max(0, Math.min(1, cmpHealth.GetHitpoints() / cmpHealth.GetMaxHitpoints()));
	var buildingHitpoints = Math.round(cmpBuildingHealth.GetMaxHitpoints() * healthFraction);
	cmpBuildingHealth.SetHitpoints(buildingHitpoints);

	PlaySound("constructed", building);

	Engine.PostMessage(ent, MT_ConstructionFinished,
		{ "entity": ent, "newentity": building });
	Engine.BroadcastMessage(MT_EntityRenamed, { entity: ent, newentity: building });

	Engine.DestroyEntity(ent);
}

Engine.RegisterGlobal("GetFormationRequirements", GetFormationRequirements);
Engine.RegisterGlobal("CanMoveEntsIntoFormation", CanMoveEntsIntoFormation);
Engine.RegisterGlobal("ProcessCommand", ProcessCommand);
