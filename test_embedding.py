import asyncio
import os
from dotenv import load_dotenv
load_dotenv()
from google import genai

client = genai.Client()

async def test():
    try:
        res = await client.aio.models.embed_content(
            model='text-embedding-004', 
            contents=['Hello', 'World']
        )
        print('Dir:', dir(res))
        print('Has embeddings:', hasattr(res, 'embeddings'))
        if hasattr(res, 'embeddings'):
            print('Type of embeddings:', type(res.embeddings))
            print('Type of first element:', type(res.embeddings[0]))
            print('Has values:', hasattr(res.embeddings[0], 'values'))
    except Exception as e:
        print('ERR', e)

        try:
            res2 = await client.aio.models.embed_content(
                model='models/text-embedding-004', 
                contents=['Hello', 'World']
            )
            print("Second attempt:", type(res2))
        except Exception as e2:
            print("ERR2", e2)

asyncio.run(test())
