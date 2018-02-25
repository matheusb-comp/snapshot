# Snapshot
Node.js script to stream Stellar Operations until an inflation operation is detected, then get the list of voters and data pairs from the supplied stellar-core database and save it as a JSON file.

## Help
```
  Usage: snapshot.js <flags>

  Flags:
  	--test, -t:	Run the script on testnet, if false, run on livenet (default: false)
  	--local, -l:	Connect to a local horizon instance, if false, use SDF's (default: false)
  	--database, -d:	PostgreSQL connection string (default: "postgresql://stellar@localhost:5432/core")
  		You can check more info here: https://www.postgresql.org/docs/current/static/libpq-connect.html#id-1.7.3.8.3.6
  	--horizon, -h:	Horizon URL to connect if the "local" flag is set (default: "http://localhost:8000")
  	--pool, -p:	Public address ID of the pool (default: "GCCD6AJOYZCUAQLX32ZJF2MKFFAUJ53PVCFQI3RHWKL3V47QYE2BNAUT")
  	--key, -k:	Format of key for a voter data pair to mark a donation (default: "lumenaut.net donation%")

  Example:
  	snapshot.js -t true -l true -d postgresql://stellar@localhost:5432/testcore -h http://localhost:8001 -k "lumenaut.net donation%" -p GCFXD4OBX4TZ5GGBWIXLIJHTU2Z6OWVPYYU44QSKCCU7P2RGFOOHTEST
```

### Generated file example
```
{
  "inflationdest": "GCFXD4OBX4TZ5GGBWIXLIJHTU2Z6OWVPYYU44QSKCCU7P2RGFOOHTEST",
  "balance": 1698217052159796,
  "inflation": 48963751466558,
  "created": "2018-02-25T01:27:40Z",
  "expires": "2018-03-04T01:27:40Z",
  "operation": "32559962387398657",
  "txhash": "531a86ecad68525a361149a02e04e04c39dd949a74ccecfa352c1fb602972084",
  "entries": [
    {
      "account": "GCCP32JQH5XVVGVFJKTQUQUX2M6UTAAYV5VMKSMWXVALNW2NRP52BCEX",
      "balance": 111300515920,
      "data": [
        {
          "dataname": "lumenaut.net donation ANOTHER_WORD",
          "datavalue": "10%GCCP32JQH5XVVGVFJKTQUQUX2M6UTAAYV5VMKSMWXVALNW2NRP52BCEX"
        },
        {
          "dataname": "lumenaut.net donation VOTER_WORD_HERE",
          "datavalue": "25%GCFXD4OBX4TZ5GGBWIXLIJHTU2Z6OWVPYYU44QSKCCU7P2RGFOOHTEST"
        }
      ]
    },
    {
      "account": "GD6ULXQTOFQZQEYDOHUYQ43A4SXVB25N3K7CKZOUHPXIOAM5OHV25AUS",
      "balance": 111337577232,
      "data": null
    },
    {
      "account": "GD6VAPFD4PQQJK5TMMDGOMPXV24XS2SKOWL6T7OUYFQN6GSA2DMCZL7B",
      "balance": 117133788378,
      "data": [
        {
          "dataname": "lumenaut.net donation Japanese char gave [manageDataInvalidName]",
          "datavalue": "0.01666%GDF3QETYBA7DOOU45ZLLN4NGFODZXQGXBTX6DN7FUS66VFSVDOG3ATTR"
        },
        {
          "dataname": "lumenaut.net donation <insert \"joke\" here>",
          "datavalue": "$_$%THISWONTWORK.我が儘.HAHA"
        }
      ]
    },
    {
      "account": "GDF3QETYBA7DOOU45ZLLN4NGFODZXQGXBTX6DN7FUS66VFSVDOG3ATTR",
      "balance": 100418612507,
      "data": [
        {
          "dataname": "lumenaut.net donation now I can write anything I want here :)",
          "datavalue": "96%GD6VAPFD4PQQJK5TMMDGOMPXV24XS2SKOWL6T7OUYFQN6GSA2DMCZL7B"
        }
      ]
    },
    {
      "account": "GCFXD4OBX4TZ5GGBWIXLIJHTU2Z6OWVPYYU44QSKCCU7P2RGFOOHTEST",
      "balance": 1698217052159796,
      "data": null
    }
  ]
}
```
