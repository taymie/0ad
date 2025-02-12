/* Copyright (C) 2012 Wildfire Games.
 * This file is part of 0 A.D.
 *
 * 0 A.D. is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * 0 A.D. is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with 0 A.D.  If not, see <http://www.gnu.org/licenses/>.
 */

#include "precompiled.h"

#include "simulation2/system/Component.h"
#include "ICmpWaterManager.h"

#include "graphics/RenderableObject.h"
#include "graphics/Terrain.h"
#include "renderer/Renderer.h"
#include "renderer/WaterManager.h"
#include "simulation2/MessageTypes.h"

class CCmpWaterManager : public ICmpWaterManager
{
public:
	static void ClassInit(CComponentManager& componentManager)
	{
		componentManager.SubscribeToMessageType(MT_Interpolate);
		componentManager.SubscribeToMessageType(MT_TerrainChanged);
	}

	DEFAULT_COMPONENT_ALLOCATOR(WaterManager)

	// Dynamic state:

	entity_pos_t m_WaterHeight;

	static std::string GetSchema()
	{
		return "<a:component type='system'/><empty/>";
	}

	virtual void Init(const CParamNode& UNUSED(paramNode))
	{
		SetWaterLevel(entity_pos_t::FromInt(5));
	}

	virtual void Deinit()
	{
	}

	virtual void Serialize(ISerializer& serialize)
	{
		serialize.NumberFixed_Unbounded("height", m_WaterHeight);
	}

	virtual void Deserialize(const CParamNode& paramNode, IDeserializer& deserialize)
	{
		Init(paramNode);

		deserialize.NumberFixed_Unbounded("height", m_WaterHeight);
	}

	virtual void HandleMessage(const CMessage& msg, bool UNUSED(global))
	{
		switch (msg.GetType())
		{
			case MT_Interpolate:
			{
				const CMessageInterpolate& msgData = static_cast<const CMessageInterpolate&> (msg);
				if (CRenderer::IsInitialised())
					g_Renderer.GetWaterManager()->m_WaterTexTimer += msgData.deltaSimTime;
				break;
			}
			case MT_TerrainChanged:
			{
				// Tell the renderer to redraw the map.
				if (CRenderer::IsInitialised())
				{
					g_Renderer.GetWaterManager()->m_NeedsFullReloading = true;
					g_Renderer.GetWaterManager()->m_NeedsReloading = true;
					g_Renderer.GetWaterManager()->m_TerrainChangeThisTurn = true;
				}
				break;
			}
		}
	}

	virtual void SetWaterLevel(entity_pos_t h)
	{
		m_WaterHeight = h;

		// Tell the terrain it'll need to recompute its cached render data
		GetSimContext().GetTerrain().MakeDirty(RENDERDATA_UPDATE_VERTICES);
	}

	virtual entity_pos_t GetWaterLevel(entity_pos_t UNUSED(x), entity_pos_t UNUSED(z))
	{
		return m_WaterHeight;
	}

	virtual float GetExactWaterLevel(float UNUSED(x), float UNUSED(z))
	{
		return m_WaterHeight.ToFloat();
	}
};

REGISTER_COMPONENT_TYPE(WaterManager)
