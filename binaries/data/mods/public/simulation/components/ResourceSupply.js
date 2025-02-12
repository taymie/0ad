function ResourceSupply() {}

ResourceSupply.prototype.Schema =
	"<a:help>Provides a supply of one particular type of resource.</a:help>" +
	"<a:example>" +
		"<Amount>1000</Amount>" +
		"<Type>food.meat</Type>" +
	"</a:example>" +
	"<element name='KillBeforeGather' a:help='Whether this entity must be killed (health reduced to 0) before its resources can be gathered'>" +
		"<data type='boolean'/>" +
	"</element>" +
	"<element name='Amount' a:help='Amount of resources available from this entity'>" +
		"<data type='nonNegativeInteger'/>" +
	"</element>" +
	"<element name='Type' a:help='Type of resources'>" +
		"<choice>" +
			"<value>wood.tree</value>" +
			"<value>wood.ruins</value>" +
			"<value>stone.rock</value>" +
			"<value>stone.ruins</value>" +
			"<value>metal.ore</value>" +
			"<value>food.fish</value>" +
			"<value>food.fruit</value>" +
			"<value>food.grain</value>" +
			"<value>food.meat</value>" +
			"<value>food.milk</value>" +
			"<value>treasure.wood</value>" +
			"<value>treasure.stone</value>" +
			"<value>treasure.metal</value>" +
			"<value>treasure.food</value>" +
		"</choice>" +
	"</element>" +
	"<element name='MaxGatherers' a:help='Amount of gatherers who can gather resources from this entity at the same time'>" +
		"<data type='nonNegativeInteger'/>" +
	"</element>";

ResourceSupply.prototype.Init = function()
{
	// Current resource amount (non-negative)
	this.amount = this.GetMaxAmount();
    this.gatherers = [];	// list of IDs
};

ResourceSupply.prototype.GetKillBeforeGather = function()
{
	return (this.template.KillBeforeGather == "true");
};

ResourceSupply.prototype.GetMaxAmount = function()
{
	return +this.template.Amount;
};

ResourceSupply.prototype.GetCurrentAmount = function()
{
	return this.amount;
};

ResourceSupply.prototype.GetMaxGatherers = function()
{
	return +this.template.MaxGatherers;
};

ResourceSupply.prototype.GetGatherers = function()
{
	return this.gatherers;
};

ResourceSupply.prototype.TakeResources = function(rate)
{
	// 'rate' should be a non-negative integer

	var old = this.amount;
	this.amount = Math.max(0, old - rate);
	var change = old - this.amount;

	// Remove entities that have been exhausted
	if (this.amount == 0)
		Engine.DestroyEntity(this.entity);

	Engine.PostMessage(this.entity, MT_ResourceSupplyChanged, { "from": old, "to": this.amount });

	return { "amount": change, "exhausted": (this.amount == 0) };
};

ResourceSupply.prototype.GetType = function()
{
	// All resources must have both type and subtype

	var [type, subtype] = this.template.Type.split('.');
	return { "generic": type, "specific": subtype };
};

ResourceSupply.prototype.IsAvailable = function(gathererID)
{
	if (this.gatherers.length < this.GetMaxGatherers() || this.gatherers.indexOf(gathererID) !== -1)
		return true;
	return false;
};

ResourceSupply.prototype.AddGatherer = function(gathererID)
{
	if (!this.IsAvailable(gathererID))
		return false;
 	
	if (this.gatherers.indexOf(gathererID) === -1)
	{
		this.gatherers.push(gathererID);
		// broadcast message, mainly useful for the AIs.
		Engine.PostMessage(this.entity, MT_ResourceSupplyGatherersChanged, { "to": this.gatherers });
	}
	
	return true;
};

// should this return false if the gatherer didn't gather from said resource?
ResourceSupply.prototype.RemoveGatherer = function(gathererID)
{
	if (this.gatherers.indexOf(gathererID) !== -1)
	{
		this.gatherers.splice(this.gatherers.indexOf(gathererID),1);
		// broadcast message, mainly useful for the AIs.
		Engine.PostMessage(this.entity, MT_ResourceSupplyGatherersChanged, { "to": this.gatherers });
	}
};

Engine.RegisterComponentType(IID_ResourceSupply, "ResourceSupply", ResourceSupply);
